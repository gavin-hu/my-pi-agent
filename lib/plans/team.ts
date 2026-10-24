/**
 * The plan's `## Team` section (pure): the split a plan was approved with.
 *
 * The section is a sentence naming the lead's unit plus a GFM table, because the
 * review screen already renders a heading and a table — the block model has a
 * `table` kind — so the split needs no renderer of its own, and the browser page
 * anchors its comments to the same source lines everything else reads.
 *
 * Render and parse are the same module on purpose: the table's shape is a wire
 * format between approval (`plan`) and joining (`session-bus`), which never
 * imports this extension, so both sides must agree on one writer.
 */

import { replaceSection, teamSectionBody } from "./sections.ts";

/** One workstream a plan was split into. */
export interface PlanUnit {
	/** Lowercase slug used to address the unit; also the session label its owner takes. */
	name: string;
	/** Repository-relative path prefixes the unit owns. */
	paths: string[];
	/** The command that proves the unit is done. */
	test: string;
	/** Units that must land first. */
	dependsOn: string[];
	/** True for the one unit the approving session keeps. */
	lead?: boolean;
}

/** A split as it was written into a plan. */
export interface PlanTeam {
	/** The unit the approving session works. */
	lead: string;
	units: PlanUnit[];
}

/** Where the section's own heading lives, so a caller can name it in an error. */
export const TEAM_SECTION = "Team";

/** Unit names are addressed as session labels, so they take the same shape. */
export const UNIT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** A value that would break the table or a message. */
const UNSAFE = /[|\n\r]/;
const NONE = "—";

/**
 * Render the section's body.
 *
 * Values are narrowed to one line so a path or a title cannot break the table it
 * is written into; a caller that validates first gets a refusal instead of a
 * mangled table.
 */
export function renderTeam(team: PlanTeam): string {
	const rows = team.units.map((unit) => {
		const paths = unit.paths.join(", ");
		const depends = unit.dependsOn.length > 0 ? unit.dependsOn.join(", ") : NONE;
		return `| ${unit.name} | ${paths} | ${unit.test} | ${depends} |`;
	});
	return [`Lead: ${team.lead}`, "", "| unit | paths | test | depends on |", "| --- | --- | --- | --- |", ...rows].join(
		"\n",
	);
}

/** One cell's text, without the inline code a writer may have used. */
function clean(cell: string | undefined): string {
	return (cell ?? "")
		.trim()
		.replace(/^`+|`+$/g, "")
		.trim();
}

/** Split a table cell into its values, dropping backticks and padding. */
function cells(cell: string): string[] {
	return cell
		.split(",")
		.map((value) =>
			value
				.trim()
				.replace(/^`+|`+$/g, "")
				.trim(),
		)
		.filter((value) => value !== "" && value !== NONE);
}

/**
 * Parse a section body back into a team.
 *
 * Every malformed row is an error rather than a silent skip: a team read wrong is
 * a session joining the wrong paths, which is the one failure this feature exists
 * to prevent.
 */
export function parseTeam(body: string): PlanTeam | { error: string } {
	const lines = body.split("\n").map((line) => line.trim());
	const leadLine = lines.find((line) => /^lead:/i.test(line));
	const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-{3}/.test(line));
	const lead = clean(leadLine?.replace(/^lead:/i, ""));
	if (!lead) return { error: "The team section has no `Lead: <unit>` line." };

	const [header, ...data] = rows;
	if (!header) return { error: "The team section has no table." };
	const columns = header
		.split("|")
		.slice(1, -1)
		.map((cell) => cell.trim().toLowerCase());
	const at = (name: string): number => columns.indexOf(name);
	const nameAt = at("unit");
	const pathsAt = at("paths");
	const testAt = at("test");
	const dependsAt = at("depends on");
	if (nameAt < 0 || pathsAt < 0 || testAt < 0) {
		return { error: "The team table needs `unit`, `paths`, and `test` columns." };
	}

	const units: PlanUnit[] = [];
	for (const row of data) {
		const values = row.split("|").slice(1, -1);
		const name = clean(values[nameAt]);
		if (!name || !UNIT_NAME.test(name)) return { error: `"${name}" is not a unit name.` };
		const paths = cells(values[pathsAt] ?? "");
		const test = clean(values[testAt]);
		if (paths.length === 0) return { error: `Unit "${name}" lists no paths.` };
		if (!test) return { error: `Unit "${name}" lists no test.` };
		const dependsOn = dependsAt < 0 ? [] : cells(values[dependsAt] ?? "");
		units.push({ name, paths, test, dependsOn, ...(name === lead ? { lead: true } : {}) });
	}
	if (units.length === 0) return { error: "The team table has no units." };
	if (!units.some((unit) => unit.name === lead)) return { error: `The lead "${lead}" is not one of the units.` };
	return { lead, units };
}

/** The team a plan was approved with, or undefined when it has none. */
export function readTeam(plan: string): PlanTeam | { error: string } | undefined {
	const body = teamSectionBody(plan);
	return body === undefined ? undefined : parseTeam(body);
}

/** The plan with its team section rewritten. */
export function writeTeam(plan: string, team: PlanTeam): string {
	return replaceSection(plan, TEAM_SECTION, renderTeam(team));
}

/** Whether any rendered value would break the table. */
export function unsafeValue(team: PlanTeam): string | undefined {
	for (const unit of team.units) {
		for (const value of [unit.name, unit.test, ...unit.paths, ...unit.dependsOn]) {
			if (UNSAFE.test(value)) return value;
		}
	}
	return UNSAFE.test(team.lead) ? team.lead : undefined;
}
