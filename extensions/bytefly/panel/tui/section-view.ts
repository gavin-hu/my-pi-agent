/**
 * What the sections show, derived from the session's sources: the counts on the
 * tabs, the one body height they share, the attention in the header, the filter
 * chips, and the merged model the rows are drawn from.
 *
 * One module because these are one question asked five ways — "what is on this
 * screen, and what does it add up to" — and because the component should be left
 * with the state it mutates and the keys it reads, not the arithmetic over it.
 *
 * Pure: the source is handed in, no host is touched, and nothing is cached.
 */

import type { ExtensionReport } from "../../../../lib/requirements.ts";
import { filterChips, isFiltering, rowMatches, type PanelFilter } from "../filter.ts";
import { attentionSegments, panelCounts, type SummarySegment } from "../format.ts";
import { buildPanelModel, buildSkillModel, groupedEntryCount } from "../join.ts";
import type { ResourceItem, ResourceKind, WriteScope } from "../../picker/types.ts";
import type { SettingsSurface } from "../settings-runtime.ts";
import type { PanelModel, PanelRow, PanelSection, SkillInfo } from "../types.ts";
import { settingEntries } from "./entries.ts";

/** Everything the screen derives its content from. */
export interface ViewSource {
	/** The write scope the settings rows are read in. */
	scope: WriteScope;
	/** The resolved resources of one kind. */
	items(kind: ResourceKind): readonly ResourceItem[];
	/** The current doctor reports. */
	reports(): readonly ExtensionReport[];
	/** The settings surface, for its rows. */
	settings: SettingsSurface;
	/** The agent directory the resource groups are labelled from. */
	agentDir: string;
	/** What the reader narrowed the rows to. */
	filter: PanelFilter;
	/** The extension the command narrowed to, if it named one. */
	commandFilter?: string;
	/** Something was changed this session. */
	dirty: boolean;
}

/**
 * The merged model for a list section. `filtered` off skips the reader's filter,
 * which is what the header's attention counts need: narrowing the list must not
 * hide a problem.
 */
export function modelFor(
	source: ViewSource,
	kind: ResourceKind,
	skills: () => ReadonlyMap<string, SkillInfo>,
	filtered = true,
): PanelModel {
	const where = filtered && isFiltering(source.filter) ? (row: PanelRow) => rowMatches(row, source.filter) : undefined;
	if (kind === "skills") {
		return buildSkillModel({ items: source.items("skills"), index: skills(), agentDir: source.agentDir, where });
	}
	return buildPanelModel({
		items: source.items("extensions"),
		reports: source.reports(),
		agentDir: source.agentDir,
		filter: source.commandFilter,
		where,
	});
}

/**
 * The section sizes the tabs print: the resources each section holds. They count
 * what the section has, not what a filter left, so a tab does not shrink while
 * another section is being narrowed.
 */
export function sectionCounts(source: ViewSource): Record<PanelSection, number> {
	return {
		extensions: source.items("extensions").length,
		skills: source.items("skills").length,
		settings: source.settings.views(source.scope).length,
	};
}

/**
 * The tallest section's entry count, group headings included. All three sections
 * pad their body to it, which is what keeps the dock from resizing when the tabs
 * change. Counted through `groupedEntryCount`, so measuring Skills never reads a
 * `SKILL.md`.
 */
export function tallestBody(source: ViewSource): number {
	const lists = (["extensions", "skills"] as const).map((kind) =>
		groupedEntryCount(source.items(kind), source.agentDir, kind),
	);
	const settings = settingEntries(source.settings.views(source.scope)).length;
	return Math.max(1, ...lists, settings);
}

/** The header's attention, over every extension rather than the filter. */
export function attentionFor(source: ViewSource): SummarySegment[] {
	return attentionSegments(panelCounts(modelFor(source, "extensions", () => new Map(), false)), source.dirty);
}

/** The chips the tab row shows: the filter editor while open, else what applies. */
export function chipsFor(
	source: ViewSource,
	section: PanelSection,
	editing: { buffer: string } | undefined,
): SummarySegment[] {
	if (editing !== undefined) return [{ text: `/${editing.buffer}▏`, color: "accent" }];
	const chips = filterChips(source.filter, section === "settings" ? "settings" : "rows");
	// The command's own narrowing (`/bytefly plan`) is a filter the reader did not
	// ask for this time, so the tab row says why the list is short.
	if (source.commandFilter !== undefined && section === "extensions") {
		chips.unshift({ text: `${source.commandFilter} only`, color: "meta" });
	}
	return chips;
}

/** The line a section shows in place of its body. */
export function emptyLabelFor(filter: PanelFilter, section: PanelSection): string {
	if (isFiltering(filter)) return "Nothing matches the filter.";
	if (section === "skills") return "No skills found.";
	if (section === "settings") return "No settings found.";
	return "No extensions found.";
}

/** The group heading a row sits under, for the block's `Source` fact. */
export function groupLabelFor(model: PanelModel | undefined, row: PanelRow | undefined): string | undefined {
	if (model === undefined || row === undefined) return undefined;
	return model.groups.find((group) => group.key === row.group)?.label;
}
