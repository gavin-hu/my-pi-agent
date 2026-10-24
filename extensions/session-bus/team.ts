/**
 * Reading a split out of the plan store, for a session that did not write it.
 *
 * The bus and plan mode never import each other, so the plan file is the
 * contract: this module finds the newest plan that carries a valid `## Team`
 * section, or the one a `join` named, and reads it through the shared parser.
 * Everything here is a refusal with a reason — a hand-edited or stale section
 * must never half-read, because a unit read wrong is a session claiming the
 * wrong paths — so the read runs the gate's own rules (`readSplit`), not only
 * the table's shape.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { shortenPath } from "../../lib/format.ts";
import { readSplit } from "../../lib/plans/split.ts";
import type { PlanUnit } from "../../lib/plans/team.ts";

/** One unit, with the team it belongs to. */
export interface JoinedUnit {
	team: string;
	name: string;
	paths: string[];
}

/** The team a `join` or a status line is about. */
export interface TeamRef {
	team: string;
	units: PlanUnit[];
}

/**
 * Resolve a `team`/`unit` pair to the paths a join claims.
 *
 * `team` is the plan file's stem, which is why two plans in one repository never
 * share a team: the stamp in the name is what keeps them apart.
 */
export function resolveUnit(plansRoot: string, input: { team?: string; unit?: string }, verb = "join"): JoinedUnit {
	const team = input.team?.trim();
	const wanted = input.unit?.trim();
	if (!team) throw new Error(`${verb} needs a team: pass the plan file name without ".md".`);
	if (!wanted) throw new Error(`${verb} needs a unit inside "${team}".`);
	const file = join(plansRoot, `${team.replace(/[\\/]/g, "")}.md`);
	let content: string;
	try {
		content = readFileSync(file, "utf-8");
	} catch {
		throw new Error(`No split plan named "${team}" in this repository's plan store (${shortenPath(plansRoot)}).`);
	}
	const parsed = readSplit(content);
	if (parsed === undefined) {
		throw new Error(`"${team}" has no team section; a split is written when a plan is approved with plan.team on.`);
	}
	if ("error" in parsed) throw new Error(`${team}: ${parsed.error}`);
	const unit = parsed.units.find((entry) => entry.name === wanted);
	if (!unit) {
		const known = parsed.units.map((entry) => entry.name).join(", ");
		throw new Error(`"${team}" has no unit "${wanted}"; it has ${known}.`);
	}
	return { team, name: unit.name, paths: [...unit.paths] };
}

/** How many of the newest plans a status call reads before giving up on finding a split. */
const MAX_TEAM_SCAN = 20;

/** The newest plan in the store that carries a team, or undefined when none does. */
export function newestTeam(plansRoot: string): TeamRef | undefined {
	let names: string[];
	try {
		names = readdirSync(plansRoot).filter((name) => name.toLowerCase().endsWith(".md") && !name.startsWith("."));
	} catch {
		return undefined;
	}
	const stamped = names
		.map((name) => {
			try {
				return { name, at: statSync(join(plansRoot, name)).mtimeMs };
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is { name: string; at: number } => entry !== undefined)
		.sort((a, b) => b.at - a.at)
		.slice(0, MAX_TEAM_SCAN);
	for (const entry of stamped) {
		try {
			const team = readSplit(readFileSync(join(plansRoot, entry.name), "utf-8"));
			if (team !== undefined && !("error" in team)) {
				return { team: entry.name.replace(/\.md$/i, ""), units: team.units };
			}
		} catch {
			// An unreadable plan is simply not the newest team.
		}
	}
	return undefined;
}

/** The label holding any of `unit`'s paths, from the bus's claims. */
export function unitHolder(
	unit: PlanUnit,
	claims: readonly { path: string; ownerLabel: string }[],
	conflicts: (a: string, b: string) => boolean,
): string | undefined {
	return claims.find((claim) => unit.paths.some((path) => conflicts(claim.path, path)))?.ownerLabel;
}
