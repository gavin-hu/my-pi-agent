/**
 * Whether a plan can be executed in parallel, and by whom (pure).
 *
 * The model proposes the split; this decides whether it is one. Nothing here
 * reads the disk: the refusal rules are facts about the table the plan would be
 * approved with, so they are testable in isolation and identical on every
 * platform.
 *
 * A refusal is the point of the feature. A split whose units overlap, or whose
 * dependency graph loops, or that hands a shared file to an owner, is what costs
 * sessions rather than one tool call — so each rule names the offending pair
 * instead of returning a boolean.
 */

import { claimsConflict, findClaimOverlap, normalizeClaimPath } from "../claims/overlap.ts";
import { type PlanTeam, type PlanUnit, readTeam, UNIT_NAME, unsafeValue } from "./team.ts";

/** Most non-lead units a team may have: the user switches to each one every round. */
export const MAX_OWNERS = 2;

/**
 * Files every workstream touches, so an owner that writes one is a merge conflict
 * by rule. The lead lands them; the project can extend the list through config.
 */
export const SHARED_FILES: readonly string[] = [
	"package.json",
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"CHANGELOG.md",
	"README.md",
	"README.zh-CN.md",
	"test/suite-manifest.ts",
	"test/naming.test.ts",
	"test/structure.test.ts",
	"lib/tool-names.ts",
	"lib/requirements.ts",
];

/** What approval does with a proposed split: a team, or the reason there is none. */
export type SplitCheck = ({ ok: true; verdict: "pair" | "team" } & PlanTeam) | { ok: false; reason: string };

/** A unit named in a refusal, so the message says which two collide. */
function unitAt(units: readonly PlanUnit[], index: number): string {
	return units[index]?.name ?? `unit ${index + 1}`;
}

/**
 * Whether `path` covers, or is covered by, any shared file, and which one.
 *
 * Exported because it is the one shared-file rule: approval refuses an owner unit
 * whose paths cover one, and `session-bus` refuses the same file at claiming time
 * through `sharedFileFor`, so the two cannot disagree about what "shared" means.
 */
export function sharedFileFor(path: string, shared: readonly string[] = SHARED_FILES): string | undefined {
	return shared.find((file) => claimsConflict(path, file));
}

/**
 * Walk the `dependsOn` graph and report the first cycle as a readable path.
 *
 * A cycle means no unit can start, so it is refused rather than reordered: a
 * dependency that points both ways usually means the split cut through one
 * workstream instead of between two.
 */
function findCycle(units: readonly PlanUnit[]): string[] | undefined {
	const byName = new Map(units.map((unit) => [unit.name, unit]));
	const state = new Map<string, "open" | "done">();
	const path: string[] = [];

	const visit = (name: string): string[] | undefined => {
		const mark = state.get(name);
		if (mark === "done") return undefined;
		if (mark === "open") return [...path.slice(path.indexOf(name)), name];
		state.set(name, "open");
		path.push(name);
		for (const next of byName.get(name)?.dependsOn ?? []) {
			const cycle = visit(next);
			if (cycle) return cycle;
		}
		path.pop();
		state.set(name, "done");
		return undefined;
	};

	for (const unit of units) {
		const cycle = visit(unit.name);
		if (cycle) return cycle;
	}
	return undefined;
}

/**
 * Decide what approval does with `units`.
 *
 * Fewer than two units is refused with the skeleton advice: a single path proven
 * end to end is what a split should be cut from, and approving it as a team would
 * write a table with nobody to join. Approving with no `units` at all is
 * `decideSplit`'s answer, not this one — it is the single flow, not a bad split.
 */
export function checkSplit(
	units: readonly PlanUnit[] | undefined,
	shared: readonly string[] = SHARED_FILES,
): SplitCheck {
	if (!units || units.length < 2) {
		return {
			ok: false,
			reason:
				"A split needs at least two units. Approve as one flow, or build the thinnest end-to-end path first and approve a split once the boundary is real.",
		};
	}

	const names = new Set<string>();
	for (const unit of units) {
		if (!UNIT_NAME.test(unit.name)) {
			return { ok: false, reason: `"${unit.name}" is not a unit name; use lowercase letters, digits, and hyphens.` };
		}
		if (names.has(unit.name)) return { ok: false, reason: `Two units are both named "${unit.name}".` };
		names.add(unit.name);
		if (unit.paths.length === 0) return { ok: false, reason: `Unit "${unit.name}" claims no paths.` };
		if (!unit.test.trim())
			return { ok: false, reason: `Unit "${unit.name}" has no test; name the command that proves it.` };
	}
	// A piped or multiline value breaks the row; a comma breaks a path list, which
	// is one cell. The message names every rule because the value is all it has.
	const unsafe = unsafeValue({ lead: units.find((unit) => unit.lead)?.name ?? "", units: [...units] });
	if (unsafe !== undefined) {
		return {
			ok: false,
			reason: `"${unsafe}" would break the team table; remove the pipe, the line break, or the comma.`,
		};
	}

	const leads = units.filter((unit) => unit.lead);
	if (leads.length !== 1) {
		return {
			ok: false,
			reason:
				leads.length === 0
					? "No unit is marked as the lead's; the approving session needs one unit of its own."
					: `Units ${leads.map((unit) => `"${unit.name}"`).join(" and ")} are both marked lead; only one may be.`,
		};
	}
	const lead = leads[0].name;
	const owners = units.filter((unit) => !unit.lead);
	if (owners.length > MAX_OWNERS) {
		return {
			ok: false,
			reason: `A team has at most ${MAX_OWNERS} owners plus the lead; ${owners.length} owners means the split is wrong, not the team too small.`,
		};
	}

	// Overlap is checked across units, naming the pair: the same predicate the bus
	// applies to claims, so approval and claiming cannot disagree.
	for (const unit of units) {
		const inside = findClaimOverlap(unit.paths.map(normalizeClaimPath));
		if (inside) {
			return {
				ok: false,
				reason: `Unit "${unit.name}" lists paths that cover each other: ${inside[0]} and ${inside[1]}. Keep the narrower one.`,
			};
		}
	}
	for (let i = 0; i < units.length; i++) {
		for (let j = i + 1; j < units.length; j++) {
			for (const left of units[i].paths) {
				for (const right of units[j].paths) {
					if (claimsConflict(left, right)) {
						return {
							ok: false,
							reason: `Units "${unitAt(units, i)}" and "${unitAt(units, j)}" overlap: ${left} and ${right}. Combine them or serialize.`,
						};
					}
				}
			}
		}
	}

	for (const unit of units) {
		if (unit.lead) continue;
		// `find`, not a first element: a unit's shared file is rarely its first path, and
		// reading only `at(0)` let every later one through the gate.
		const hit = unit.paths.map((path) => sharedFileFor(path, shared)).find((file) => file !== undefined);
		if (hit !== undefined) {
			return {
				ok: false,
				reason: `Unit "${unit.name}" claims ${hit}, which every workstream touches; the lead lands shared files.`,
			};
		}
	}

	for (const unit of units) {
		const unknown = unit.dependsOn.find((name) => !names.has(name));
		if (unknown !== undefined) {
			return { ok: false, reason: `Unit "${unit.name}" depends on "${unknown}", which is not a unit.` };
		}
	}
	const cycle = findCycle(units);
	if (cycle) return { ok: false, reason: `Dependencies loop: ${cycle.join(" → ")}.` };

	return { ok: true, verdict: owners.length === 1 ? "pair" : "team", lead, units: units.map((unit) => ({ ...unit })) };
}

/**
 * The team a plan file carries, valid as an approval would have made it.
 *
 * The table is a wire format, so a section that was hand-edited, written by a
 * version that did not know this rule, or copied from another plan must not reach
 * a session: `readTeam` shapes it, and this decides whether it is a split at all
 * with the same rules approval applies — overlap, cycles, owner count, a test, a
 * shared file held by an owner, and one lead.
 */
export function readSplit(plan: string): PlanTeam | { error: string } | undefined {
	const team = readTeam(plan);
	if (team === undefined || "error" in team) return team;
	const check = checkSplit(team.units);
	return check.ok ? team : { error: check.reason };
}

/**
 * Merge order: the units in dependency order, ties broken by their place in the
 * table, so the lead merges what everything else builds on first.
 */
export function mergeOrder(units: readonly PlanUnit[]): string[] {
	const placed: string[] = [];
	const done = new Set<string>();
	const remaining = [...units];
	const names = new Set(units.map((unit) => unit.name));
	while (remaining.length > 0) {
		// The first unit whose dependencies are all placed. Approval refuses a cycle,
		// so a search that finds nothing falls back to table order rather than looping.
		const index = remaining.findIndex((unit) => unit.dependsOn.every((name) => done.has(name) || !names.has(name)));
		const [next] = remaining.splice(index < 0 ? 0 : index, 1);
		placed.push(next.name);
		done.add(next.name);
	}
	return placed;
}
