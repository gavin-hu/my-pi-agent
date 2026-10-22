/**
 * Types for the unified bytefly panel: the merged row model the formatter and
 * the screen both read.
 *
 * A row is one picker item, optionally joined to its doctor report (extensions)
 * or to what its `SKILL.md` declares (skills). Either side may be absent: an item
 * without a report renders no health, a report without an item has no checkbox,
 * and a skill Pi refused to load carries the reason instead.
 */

import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { ResourceItem } from "../picker/types.ts";

/** The control center's sections: the two resource lists and the settings list. */
export type PanelSection = "extensions" | "skills" | "settings";

/**
 * What a skill's `SKILL.md` declares, as Pi loaded it. A file Pi refused carries
 * `problem` and no name, so the row keeps the name its path gives it.
 */
export interface SkillInfo {
	/** Frontmatter name; absent when Pi did not load the file. */
	name?: string;
	/** Frontmatter description, empty when Pi did not load the file. */
	description: string;
	/** `disable-model-invocation`: reachable only through `/skill:<name>`. */
	modelHidden: boolean;
	/** Why Pi did not load the file, when it did not. */
	problem?: string;
}

/** One group header in the merged model. */
export interface PanelGroup {
	/** Group key from the picker's `buildEntries`. */
	key: string;
	/** Group label, e.g. `npm:pkg (user)`. */
	label: string;
	/** Number of rows under this group. */
	count: number;
}

/** One resource row: a picker item, a doctor report, or both. */
export interface PanelRow {
	/**
	 * Unique row identity: `source:path` for an item, `report:<name>` for a
	 * report-only row. Never the directory name, which two rows can share.
	 */
	key: string;
	/** The resolved resource item, when the picker has one. */
	item?: ResourceItem;
	/** The doctor report, when one exists for this directory. */
	report?: ExtensionReport;
	/** What the skill's `SKILL.md` declares, on a Skills row. */
	skill?: SkillInfo;
	/** Picker display name (`folder/file.ts`, a skill name), or the report name when no item. */
	label: string;
	/** Key of the group this row belongs to. */
	group: string;
}

/** The merged model: group headers and rows, both in display order. */
export interface PanelModel {
	groups: PanelGroup[];
	rows: PanelRow[];
}
