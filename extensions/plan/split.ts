/**
 * The split at approval: the switch that enables it, the roster card, and the
 * `## Team` section it writes.
 *
 * Plan mode keeps one job — the plan document and its approval gate — and this
 * module is the part of that gate that concerns a team: whether the feature is on,
 * what the user is told to run in the sessions this package cannot start, and the
 * write that makes the team real. Everything mechanical about the split itself
 * (which tables are legal, which paths collide) is `lib/plans/split.ts`, because
 * the bus reads the same section.
 */

import { resolveClaimPaths } from "../../lib/claims/resolve.ts";
import { sanitizeLine, shortenPath } from "../../lib/format.ts";
import { teamEnabled } from "../../lib/plans/setting.ts";
import { checkSplit, mergeOrder } from "../../lib/plans/split.ts";
import type { PlanTeam, PlanUnit } from "../../lib/plans/team.ts";

export { teamEnabled, TEAM_OFF_NOTE, TEAM_SETTING_ID, TEAM_SETTING_LABEL } from "../../lib/plans/setting.ts";

/** What approval decides about the units a model proposed. */
export type SplitDecision =
	| { kind: "none" }
	| { kind: "off" }
	| { kind: "refused"; reason: string }
	| { kind: "team"; team: PlanTeam; verdict: "pair" | "team" };

/**
 * Decide what to do with the `units` an approval carried.
 *
 * The switch is checked first: with it off the units are ignored entirely rather
 * than validated, so a user who never enabled the feature cannot be blocked by a
 * rule about it.
 *
 * The paths are resolved before any rule looks at them, with the function `join`
 * claims through, so an approved unit is one a session can actually hold: what the
 * table records is the canonical repository-relative path, and a unit that lists a
 * path outside the repository — or a session outside any repository — is refused
 * here, where the user can still fix it, rather than by an owner's failed join.
 */
export function decideSplit(
	cwd: string,
	root: string | undefined,
	units: readonly PlanUnit[] | undefined,
): SplitDecision {
	if (units === undefined || units.length === 0) return { kind: "none" };
	if (!teamEnabled(cwd, root)) return { kind: "off" };
	// A unit is claimed by repository-relative path, against a root every session
	// shares. Outside a repository there is no such root, so nothing could join it.
	if (root === undefined) {
		return {
			kind: "refused",
			reason:
				"A team needs a repository: units are claimed by repository-relative path, and this session is outside one.",
		};
	}
	const resolved: PlanUnit[] = [];
	for (const unit of units) {
		const keyed = resolveClaimPaths(root, unit.paths);
		if ("error" in keyed) {
			return {
				kind: "refused",
				reason: `Unit "${unit.name}" claims "${keyed.error.path}", which ${keyed.error.reason}.`,
			};
		}
		resolved.push({ ...unit, paths: keyed.paths });
	}
	const check = checkSplit(resolved);
	if (!check.ok) return { kind: "refused", reason: check.reason };
	// `checkSplit` answers "serial" only for no units at all, which the guard above
	// already answered with `none`, so what is left is a team.
	return { kind: "team", team: { lead: check.lead, units: check.units }, verdict: check.verdict };
}

/**
 * The roster card: what the user runs, in which session, and in what order.
 *
 * A lead cannot start, name, or prompt a peer session, so the card is the whole of
 * what step 3 can do — and its first line says so, because the rest of the flow
 * depends on the user believing it.
 *
 * Two facts every owner needs, and only the card can give them: a worktree is cut
 * from `origin/main`, which lags the branch the lead merges into, so it is rebased
 * before the first turn; and a unit with dependencies cannot start until they
 * land, because the interface it builds on is theirs and is not on its branch yet.
 */
export function rosterCard(team: PlanTeam, planPath: string, sessionLabel?: string): string {
	const lead = team.units.find((unit) => unit.lead)?.name ?? team.lead;
	const owners = team.units.filter((unit) => !unit.lead);
	const rows = owners.flatMap((unit) => {
		const join = `session({action:"join", team:"${teamName(planPath)}", unit:"${unit.name}"})`;
		const commands = `  ${unit.name}: enter_worktree ${unit.name} · git rebase main · /sessions name ${unit.name} · /sessions watch wake`;
		return [
			commands,
			`    ${join}`,
			...(unit.dependsOn.length === 0 ? [] : [`    start after: ${unit.dependsOn.join(", ")}`]),
		];
	});
	const order = mergeOrderLine(team);
	// The lead's own label is the one line of the card it cannot get itself until
	// after this card is printed, so the card either names it or says how to set it.
	const name = sessionLabel?.trim();
	const label = name
		? `  your label: ${sanitizeLine(name)} — owners send their report there`
		: `  your label: none — name this session: session({action:"name", label:"${lead}"})`;
	return [
		`Split: ${team.units.length} units · ${shortenPath(planPath)}`,
		"  You start and switch every session; nothing here can.",
		...rows,
		`  ${order} · your unit: ${lead}`,
		label,
	].join("\n");
}

/** The team's name is the plan file's stem, so two plans never share one. */
export function teamName(planPath: string): string {
	const name = planPath.split(/[\\/]/).pop() ?? planPath;
	return name.replace(/\.md$/i, "");
}

/** Merge order in one line, from the dependency graph the validation accepted. */
export function mergeOrderLine(team: PlanTeam): string {
	return `merge order: ${mergeOrder(team.units).join(" → ")}`;
}
