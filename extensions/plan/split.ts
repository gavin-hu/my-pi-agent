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

import { shortenPath } from "../../lib/format.ts";
import { splitEnabled } from "../../lib/plans/setting.ts";
import { checkSplit, mergeOrder } from "../../lib/plans/split.ts";
import type { PlanTeam, PlanUnit } from "../../lib/plans/team.ts";

export { SPLIT_OFF_NOTE, SPLIT_SETTING_ID, SPLIT_SETTING_LABEL, splitEnabled } from "../../lib/plans/setting.ts";

/** What approval decides about the units a model proposed. */
export type SplitDecision =
	| { kind: "none" }
	| { kind: "off" }
	| { kind: "refused"; reason: string }
	| { kind: "serial" }
	| { kind: "team"; team: PlanTeam; verdict: "pair" | "team" };

/**
 * Decide what to do with the `units` an approval carried.
 *
 * The switch is checked first: with it off the units are ignored entirely rather
 * than validated, so a user who never enabled the feature cannot be blocked by a
 * rule about it.
 */
export function decideSplit(cwd: string, units: readonly PlanUnit[] | undefined): SplitDecision {
	if (units === undefined || units.length === 0) return { kind: "none" };
	if (!splitEnabled(cwd)) return { kind: "off" };
	const check = checkSplit(units);
	if (!check.ok) return { kind: "refused", reason: check.reason };
	if (check.verdict === "serial") return { kind: "serial" };
	return { kind: "team", team: { lead: check.lead, units: check.units }, verdict: check.verdict };
}

/**
 * The roster card: what the user runs, in which session, and in what order.
 *
 * A lead cannot start, name, or prompt a peer session, so the card is the whole of
 * what step 3 can do — and its first line says so, because the rest of the flow
 * depends on the user believing it.
 */
export function rosterCard(team: PlanTeam, planPath: string): string {
	const lead = team.units.find((unit) => unit.lead)?.name ?? team.lead;
	const owners = team.units.filter((unit) => !unit.lead);
	const rows = owners.map((unit) => {
		const join = `session({action:"join", team:"${teamName(planPath)}", unit:"${unit.name}"})`;
		return `  ${unit.name}: enter_worktree ${unit.name} · /sessions name ${unit.name} · /sessions watch wake\n    ${join}`;
	});
	const order = mergeOrderLine(team);
	return [
		`Split: ${team.units.length} units · ${shortenPath(planPath)}`,
		"  You start and switch every session; nothing here can.",
		...rows,
		`  ${order} · your unit: ${lead}`,
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
