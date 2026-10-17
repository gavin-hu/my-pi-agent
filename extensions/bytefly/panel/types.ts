/**
 * Types for the unified bytefly panel: the merged row model the formatter and
 * the screen both read.
 *
 * A row is the union of one picker item and its doctor report, joined on the
 * extension directory name. Either side may be absent: an item without a report
 * renders no health, and a report without an item has no checkbox.
 */

import type { ExtensionReport } from "../../../lib/requirements.ts";
import type { ResourceItem } from "../picker/types.ts";

/** The control center's surfaces: the extension list and the settings list. */
export type PanelSection = "extensions" | "settings";

/** One group header in the merged model. */
export interface PanelGroup {
	/** Group key from the picker's `buildEntries`. */
	key: string;
	/** Group label, e.g. `npm:pkg (user)`. */
	label: string;
	/** Number of rows under this group. */
	count: number;
}

/** One extension row: a picker item, a doctor report, or both. */
export interface PanelRow {
	/**
	 * Unique row identity: `source:path` for an item, `report:<name>` for a
	 * report-only row. Never the directory name, which two rows can share.
	 */
	key: string;
	/** The resolved extension item, when the picker has one. */
	item?: ResourceItem;
	/** The doctor report, when one exists for this directory. */
	report?: ExtensionReport;
	/** Picker display name (`folder/file.ts`), or the report name when no item. */
	label: string;
	/** Key of the group this row belongs to. */
	group: string;
}

/** The merged model: group headers and rows, both in display order. */
export interface PanelModel {
	groups: PanelGroup[];
	rows: PanelRow[];
}
