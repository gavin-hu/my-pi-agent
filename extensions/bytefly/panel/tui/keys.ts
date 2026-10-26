/**
 * The control center's key table: the binding, the hint row it appears in, and
 * the help block `?` prints.
 *
 * One table, so a help line cannot drift from a binding: the component dispatches
 * through {@link keyFor}, the hint row is {@link hintsFor}, and the help block is
 * {@link helpRows}. Movement is not here — `lib/tui/cursor.ts` owns the arrows,
 * `j`/`k`, PgUp/PgDn and Home/End for every screen in the package — so the help
 * block names movement in its own row and the table stays the actions this screen
 * alone defines.
 *
 * Value-only: pure functions, the theme passed in.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ScreenHint } from "../../../../lib/tui/chrome.ts";
import { clip, padTo } from "../../../../lib/tui/columns.ts";
import { isCloseKey } from "../../../../lib/tui/cursor.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import type { PanelSection } from "../types.ts";
import { hintLine, noticeLine } from "./frame.ts";
import { editHints } from "./settings-view.ts";

/** One action the screen binds. */
export type PanelKeyId =
	| "close"
	| "previousSection"
	| "nextSection"
	| "toggle"
	| "change"
	| "detail"
	| "scope"
	| "filter"
	| "attention"
	| "refresh"
	| "reload"
	| "reset"
	| "json"
	| "inherit"
	| "help";

/** One binding, its hint label, and what the help block says about it. */
export interface PanelKey {
	id: PanelKeyId;
	/** The keys as the hint row and the help block print them. */
	label: string;
	/** The sections that offer it. A key absent from a section is not hinted there. */
	sections: readonly PanelSection[];
	/** One plain sentence for the help block. */
	help: string;
	/** Whether `data` is this key. */
	match(data: string): boolean;
}

/** Every section, and the two resource lists that share a set of keys. */
const ALL: readonly PanelSection[] = ["extensions", "skills", "settings"];
const LISTS: readonly PanelSection[] = ["extensions", "skills"];

/** Shift+Tab arrives as this sequence on terminals without the Kitty protocol. */
const SHIFT_TAB = "\u001b[Z";

/** The screen's keys, in help order. */
export const PANEL_KEYS: readonly PanelKey[] = [
	{
		id: "close",
		label: "Esc",
		sections: ALL,
		help: "Close the screen",
		match: (data) => isCloseKey(data),
	},
	{
		id: "previousSection",
		label: "←",
		sections: ALL,
		help: "Previous section",
		match: (data) =>
			matchesKey(data, Key.left) || data === "h" || matchesKey(data, Key.shift("tab")) || data === SHIFT_TAB,
	},
	{
		id: "nextSection",
		label: "→",
		sections: ALL,
		help: "Next section",
		match: (data) => matchesKey(data, Key.right) || data === "l" || matchesKey(data, Key.tab),
	},
	{
		id: "toggle",
		label: "Space",
		sections: LISTS,
		help: "Enable or disable, and re-probe when it changes",
		match: (data) => matchesKey(data, Key.space),
	},
	{
		id: "detail",
		label: "Enter",
		sections: LISTS,
		help: "Show or hide the focused row's findings",
		match: (data) => matchesKey(data, Key.enter),
	},
	{
		id: "change",
		label: "Space",
		sections: ["settings"],
		help: "Change the focused value",
		match: (data) => matchesKey(data, Key.space) || matchesKey(data, Key.enter),
	},
	{
		id: "reset",
		label: "u",
		sections: ["settings"],
		help: "Reset the focused value to its default",
		match: (data) => data === "u",
	},
	{
		id: "json",
		label: "J",
		sections: ["settings"],
		help: "Show the whole `bytefly.json` section the value lives in",
		match: (data) => data === "J",
	},
	{
		id: "scope",
		label: "s",
		sections: ALL,
		help: "Switch where a change is written: Global or Project",
		match: (data) => data === "s",
	},
	{
		id: "filter",
		label: "/",
		sections: ALL,
		help: "Filter the rows by text; Esc clears it",
		match: (data) => matchesKey(data, Key.slash),
	},
	{
		id: "attention",
		label: "!",
		sections: ALL,
		help: "Show only the rows that need attention",
		match: (data) => matchesKey(data, Key.exclamation),
	},
	{
		id: "refresh",
		label: "r",
		sections: ["extensions"],
		help: "Re-probe every extension's requirements",
		match: (data) => data === "r",
	},
	{
		id: "inherit",
		label: "x",
		sections: LISTS,
		help: "Drop the Project override, so Global applies again",
		match: (data) => data === "x",
	},
	{
		id: "reload",
		label: "R",
		sections: ALL,
		help: "Reload now, to apply what you changed",
		match: (data) => data === "R",
	},
	{
		id: "help",
		label: "?",
		sections: ALL,
		help: "Show every key, in place of the focused row's facts",
		match: (data) => matchesKey(data, Key.question),
	},
];

/** The binding for `id`; a table with no row would be a bug, not a key state. */
export function keyOf(id: PanelKeyId): PanelKey {
	const key = PANEL_KEYS.find((entry) => entry.id === id);
	if (key === undefined) throw new Error(`No panel key "${id}"`);
	return key;
}

/** The action `data` asks for in `section`, or `undefined` for anything else. */
export function keyFor(data: string, section: PanelSection): PanelKeyId | undefined {
	for (const key of PANEL_KEYS) {
		if (key.sections.includes(section) && key.match(data)) return key.id;
	}
	return undefined;
}

/** What the hint row needs to know about the screen's state. */
export interface HintState {
	/** The focused row's findings are expanded (lists only). */
	expanded: boolean;
	/** A probe is in flight, so the refresh key is not offered. */
	refreshing: boolean;
	/** Project scope can hold an override, Global cannot (lists only). */
	projectScope: boolean;
	/** Something was changed this session, so the reload key applies. */
	dirty: boolean;
	/** The help block is open. */
	help: boolean;
}

/** One pale, dim hint, or an accented primary one. */
function hint(text: string, primary = false): ScreenHint {
	return primary ? { text, color: "accent" } : text;
}

/**
 * The hint row for a section, most useful first: whole hints drop from the right
 * as the width runs out, so the close and section keys survive on a narrow
 * terminal and `?` is the one that leaves first.
 */
export function hintsFor(section: PanelSection, state: HintState): ScreenHint[] {
	const hints: ScreenHint[] = [
		hint("Esc close"),
		hint("←/→ section"),
		section === "settings" ? hint("Space change", true) : hint("Space toggle", true),
		...(section === "settings" ? [] : [hint(state.expanded ? "Enter collapse" : "Enter detail", true)]),
		hint("/ filter"),
	];
	if (section === "settings") {
		hints.push(hint("u reset"), hint(state.help ? "? hide" : "? keys"));
		return hints;
	}
	hints.push(hint(state.help ? "? hide" : "? keys"));
	if (section === "extensions") hints.push(hint(state.refreshing ? "refreshing…" : "r refresh"));
	if (state.dirty) hints.push(hint("R reload", true));
	hints.push(hint("s scope"));
	if (state.projectScope) hints.push(hint("x inherit"));
	hints.push(hint("↑/↓ select"));
	return hints;
}

/**
 * The hint row a section shows: an editor's own keys while one is open, else the
 * transient notice, else the section's hints. The three cases are exclusive, so a
 * notice never shares the row with a hint that could not work.
 */
export function hintRow(options: {
	theme: Theme;
	width: number;
	section: PanelSection;
	state: HintState;
	/** A settings row or the filter is being typed into. */
	editing: boolean;
	/** The last refusal or failure, shown until the next key. */
	notice?: string;
}): string {
	const { theme, width, section, state, editing, notice } = options;
	if (editing) return hintLine(theme, width, editHints());
	if (notice !== undefined) return noticeLine(theme, width, notice);
	return hintLine(theme, width, hintsFor(section, state));
}

/**
 * One help row: the keys it names, and what they do.
 *
 * A row naming one binding takes that binding's own sentence, so the two cannot
 * disagree; a row that explains a verb for this section — `!` narrows settings to
 * what changed, not to what is broken — states its own.
 */
interface HelpRow {
	/** Table bindings this row documents; empty for a row over shared movement keys. */
	ids: readonly PanelKeyId[];
	/** The keys as printed; joined from the bindings unless the row sets its own. */
	label?: string;
	/** What the keys do here; the single binding's own sentence when omitted. */
	help?: string;
}

/** Rows over the movement keys, which `lib/tui/cursor.ts` owns for every screen. */
const MOVEMENT: readonly HelpRow[] = [
	{ ids: [], label: "↑/↓ j/k", help: "Move to the next or previous row" },
	{ ids: [], label: "g G", help: "Jump to the first or last row" },
	{ ids: [], label: "[ ]", help: "Jump to the next or previous group" },
];

/** The help block per section: the table's own rows, plus movement and the close pair. */
const HELP: Record<PanelSection, readonly HelpRow[]> = {
	extensions: [
		{ ids: ["close", "previousSection", "nextSection"], help: "Close, or change section" },
		...MOVEMENT,
		{ ids: ["toggle"], help: "Enable or disable the focused extension" },
		{ ids: ["detail"], help: "Show or hide its findings" },
		{ ids: ["attention"], help: "Show only the rows that need attention" },
		{ ids: ["filter"], help: "Filter the rows by text; Esc clears it" },
		{ ids: ["scope"], help: "Switch where a change is written" },
		{ ids: ["refresh"], help: "Re-probe every extension's requirements" },
		{ ids: ["inherit"], help: "Drop the Project override" },
		{ ids: ["reload"], help: "Reload to apply what you changed" },
		{ ids: ["help"], help: "Show or hide this key list" },
	],
	skills: [
		{ ids: ["close", "previousSection", "nextSection"], help: "Close, or change section" },
		...MOVEMENT,
		{ ids: ["toggle"], help: "Enable or disable the focused skill" },
		{ ids: ["detail"], help: "Show or hide what its `SKILL.md` declares" },
		{ ids: ["attention"], help: "Show only the rows that need attention" },
		{ ids: ["filter"], help: "Filter the rows by text; Esc clears it" },
		{ ids: ["scope"], help: "Switch where a change is written" },
		{ ids: ["inherit"], help: "Drop the Project override" },
		{ ids: ["reload"], help: "Reload to apply what you changed" },
		{ ids: ["help"], help: "Show or hide this key list" },
	],
	settings: [
		{ ids: ["close", "previousSection", "nextSection"], help: "Close, or change section" },
		...MOVEMENT,
		{ ids: ["change"], help: "Change the focused value" },
		{ ids: ["reset"], help: "Reset it to its default" },
		{ ids: ["json"], help: "Show the section it lives in" },
		{ ids: ["attention"], help: "Show only the values you changed" },
		{ ids: ["filter"], help: "Filter the rows by text; Esc clears it" },
		{ ids: ["scope"], help: "Switch where a change is written" },
		{ ids: ["reload"], help: "Reload to apply what you changed" },
		{ ids: ["help"], help: "Show or hide this key list" },
	],
};

/** The bindings a section's help block documents, for the drift test. */
export function helpKeyIds(section: PanelSection): PanelKeyId[] {
	return HELP[section].flatMap((row) => [...row.ids]);
}

/** The keys a help row prints, from the bindings it names. */
function helpLabel(row: HelpRow): string {
	if (row.label !== undefined) return row.label;
	return row.ids.map((id) => keyOf(id).label).join(" ");
}

/** What a help row says: its own sentence, or the single binding's. */
function helpText(row: HelpRow): string {
	if (row.help !== undefined) return row.help;
	return row.ids.map((id) => keyOf(id).help).join("; ");
}

/**
 * The help block for a section: one `keys  action` line per row, the key column
 * padded to the widest label so the sentences line up. Every binding the section
 * offers has a row, and every row names a binding the section offers —
 * `keys.test.ts` holds both directions.
 */
export function helpRows(theme: Theme, width: number, section: PanelSection): string[] {
	const rows = HELP[section].map((row) => ({ label: helpLabel(row), help: helpText(row) }));
	const column = Math.max(...rows.map((row) => row.label.length)) + 2;
	const indent = " ".repeat(BODY_INDENT);
	return rows.map((row) =>
		clip(
			`${indent}${paint(theme, "faint", padTo(row.label, column))}${paint(theme, "meta", row.help)}`,
			Math.max(1, width),
		),
	);
}
