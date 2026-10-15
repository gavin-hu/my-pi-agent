/**
 * The merge behind the unified panel: one row per extension resource, joining
 * the picker's resolved items to the doctor's reports.
 *
 * The join key is the extension directory (`basename(dirname(path))`), not the
 * display name: a subfolder resource is shown as `web-access/index.ts` but its
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
 * summary.
 */

import { basename, dirname } from "node:path";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { buildEntries } from "../picker/resources.ts";
import type { ResourceItem } from "../picker/types.ts";
import type { PanelGroup, PanelModel, PanelRow } from "./types.ts";

/** The extension directory name that joins a resolved item to its report. */
export function extensionName(path: string): string {
	return basename(dirname(path));
}

/** Unique identity of a resolved resource, independent of the directory name. */
export function resourceKey(item: ResourceItem): string {
	return `${item.metadata.source}:${item.path}`;
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
}

/** Build the merged model for the current items and reports. */
export function buildPanelModel(options: PanelJoinOptions): PanelModel {
	const { items, reports, agentDir, filter } = options;
	const byName = new Map(reports.map((report) => [report.extension, report]));

	// A directory name may claim a report only when exactly one unique resource
	// path uses it. A name shared by two resources is ambiguous, so no row claims
	// the report and it stays available to the trailing `Not resolved` group.
	const pathsByName = new Map<string, Set<string>>();
	for (const item of items) {
		const name = extensionName(item.path);
		const paths = pathsByName.get(name) ?? new Set<string>();
		paths.add(resourceKey(item));
		pathsByName.set(name, paths);
	}
	const unambiguous = (name: string): boolean => pathsByName.get(name)?.size === 1;

	const claimed = new Set<string>();
	const groups: PanelGroup[] = [];
	const rows: PanelRow[] = [];
	let current: PanelGroup | undefined;

	for (const entry of buildEntries([...items], agentDir)) {
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
		rows.push({ key: resourceKey(item), item, report, label: entry.label, group: current?.key ?? "" });
		if (current) current.count += 1;
	}

	const extras = reports.filter(
		(report) => !claimed.has(report.extension) && (filter === undefined || report.extension === filter),
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
