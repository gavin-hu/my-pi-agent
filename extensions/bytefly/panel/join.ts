/**
 * The merge behind the unified panel: one row per resolved resource, joining the
 * picker's items to whatever describes them — the doctor's report for an
 * extension, the loaded `SKILL.md` metadata for a skill.
 *
 * The join key for an extension is its directory (`basename(dirname(path))`), not
 * the display name: a subfolder resource is shown as `web-access/index.ts` but its
 * report is named `web-access`. A directory name is only usable when it maps to
 * exactly one unique resource path — two unrelated extensions can share a
 * directory name (a user `plan` beside the package's `plan`) and every flat file
 * has the shared directory `extensions`, so a colliding name claims no report.
 * The report then falls through to the trailing `Not resolved` group rather than
 * lending one resource another's health.
 *
 * Row keys are the unique resource identity (`source:path`, or `report:<name>`
 * for a report with no item) so the cursor survives a rebuild even when two
 * rows share a directory name. Items keep the picker's grouping and order, and
 * a row never invents health: an item without a report carries no glyph and no
 * summary. Skills skip the report half entirely and take their label and detail
 * text from the skill index instead.
 */

import { basename, dirname } from "node:path";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { buildEntries, resourceKey } from "../picker/resources.ts";
import type { ResourceItem, ResourceKind } from "../picker/types.ts";
import type { PanelGroup, PanelModel, PanelRow, SkillInfo } from "./types.ts";

/** The extension directory name that joins a resolved item to its report. */
export function extensionName(path: string): string {
	return basename(dirname(path));
}

/**
 * The name a resource is called by on screen: the directory for an entry file
 * (`…/worktree/index.ts`, `…/pdf/SKILL.md`), and the file's own stem otherwise, so
 * a flat `extensions/auto.ts` is `auto` rather than the directory every flat file
 * shares.
 */
export function resourceName(path: string): string {
	const stem = basename(path).replace(/\.(ts|js|mjs|cjs|md)$/u, "");
	return stem === "index" || stem === "SKILL" ? basename(dirname(path)) : stem;
}

/** Row key for a report that has no resolved extension item. */
function reportKey(name: string): string {
	return `report:${name}`;
}

/** Group key and label for reports with no resolved extension item. */
export const REPORT_ONLY_GROUP = "reported-only";
export const REPORT_ONLY_LABEL = "Not resolved";

export interface PanelJoinOptions {
	items: readonly ResourceItem[];
	reports: readonly ExtensionReport[];
	agentDir: string;
	/** Narrow to one extension directory or report name, or `undefined` for the full list. */
	filter?: string;
	/** Keep only the rows this accepts; a group's count follows what survives. */
	where?: (row: PanelRow) => boolean;
	/** Which resource kind the list is, for labels and grouping. */
	kind?: ResourceKind;
}

/**
 * The rows one group list produces, group headings included. The screen measures
 * a section's height from this rather than from a built model, so a section it is
 * not showing costs no `SKILL.md` read.
 */
export function groupedEntryCount(items: readonly ResourceItem[], agentDir: string, kind: ResourceKind): number {
	return buildEntries([...items], agentDir, kind).length;
}

/** Build the merged model for the current items and reports. */
export function buildPanelModel(options: PanelJoinOptions): PanelModel {
	const { items, reports, agentDir, filter, where, kind = "extensions" } = options;
	const byName = new Map(reports.map((report) => [report.extension, report]));

	// A directory name may claim a report only when exactly one unique resource
	// path uses it. A name shared by two resources is ambiguous, so no row claims
	// the report and it stays available to the trailing `Not resolved` group.
	const pathsByName = new Map<string, Set<string>>();
	for (const item of items) {
		const name = resourceName(item.path);
		const paths = pathsByName.get(name) ?? new Set<string>();
		paths.add(resourceKey(item));
		pathsByName.set(name, paths);
	}
	const unambiguous = (name: string): boolean => pathsByName.get(name)?.size === 1;

	const claimed = new Set<string>();
	const groups: PanelGroup[] = [];
	const rows: PanelRow[] = [];
	let current: PanelGroup | undefined;

	for (const entry of buildEntries([...items], agentDir, kind)) {
		if (entry.kind === "group") {
			current = { key: entry.key, label: entry.label, count: 0 };
			groups.push(current);
			continue;
		}
		const item = entry.item;
		const name = extensionName(item.path);
		const report = unambiguous(name) ? byName.get(name) : undefined;
		if (report) claimed.add(name);
		if (filter !== undefined && name !== filter) continue;
		// The row is named for the resource, not for its file: a name is only unique
		// enough to be a name when one resource uses it, which is the same rule that
		// lets a directory claim a report. Otherwise the picker's `folder/file.ts`
		// stays, because two rows would otherwise read alike.
		const label = unambiguous(name) ? resourceName(item.path) : entry.label;
		const row: PanelRow = { key: resourceKey(item), item, report, label, group: current?.key ?? "" };
		if (where !== undefined && !where(row)) continue;
		rows.push(row);
		if (current) current.count += 1;
	}

	const extras = reports.filter(
		(report) =>
			!claimed.has(report.extension) &&
			(filter === undefined || report.extension === filter) &&
			(where === undefined ||
				where({ key: reportKey(report.extension), report, label: report.extension, group: REPORT_ONLY_GROUP })),
	);
	if (extras.length > 0) {
		const group: PanelGroup = { key: REPORT_ONLY_GROUP, label: REPORT_ONLY_LABEL, count: extras.length };
		groups.push(group);
		for (const report of extras) {
			rows.push({ key: reportKey(report.extension), report, label: report.extension, group: group.key });
		}
	}

	return { groups: groups.filter((group) => group.count > 0), rows };
}

/**
 * The Skills model: the grouped list an extension screen shows, labelled by the
 * skill's declared name and carrying what its detail pane needs. There is no
 * doctor report for a skill, so the only join is to the loaded metadata; a file
 * Pi refused keeps the name its path gives it and carries the reason.
 */
export function buildSkillModel(options: {
	items: readonly ResourceItem[];
	index: ReadonlyMap<string, SkillInfo>;
	agentDir: string;
	where?: (row: PanelRow) => boolean;
}): PanelModel {
	// The filter runs after the join: a skill's name and its `SKILL.md` facts are
	// what a reader searches and what decides whether it needs attention.
	const model = buildPanelModel({
		items: options.items,
		reports: [],
		agentDir: options.agentDir,
		kind: "skills",
	});
	const joined = model.rows.map((row) => {
		const skill = row.item ? options.index.get(row.item.path) : undefined;
		if (skill === undefined) return row;
		return { ...row, label: skill.name ?? row.label, skill };
	});
	const rows = options.where === undefined ? joined : joined.filter(options.where);
	const groups = model.groups
		.map((group) => ({ ...group, count: rows.filter((row) => row.group === group.key).length }))
		.filter((group) => group.count > 0);
	return { groups, rows };
}
