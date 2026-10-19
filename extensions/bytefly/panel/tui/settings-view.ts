/**
 * The Settings section: its summary line, one row per preference, and the
 * detail pane that names the value's source.
 *
 * Pure functions over the catalogue's views; the component owns the cursor, the
 * scope, and the write.
 */

import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip } from "../../../../lib/tui/columns.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { checkbox, listRow } from "../../../../lib/tui/rows.ts";
import { paint } from "../../../../lib/tui/tokens.ts";
import { settingsSummarySegments, type PanelScope } from "../format.ts";
import type { SettingView } from "../settings.ts";
import { configPath } from "../settings-runtime.ts";
import type { WriteScope } from "../../picker/types.ts";
import { countsLine, INDENT, savedLine } from "./frame.ts";

/** Pi's personal settings file, named in the detail pane. */
const PI_SETTINGS_FILE = "settings.json";

/** The rows this section shows, and the scope they were read in. */
export function settingsSummary(theme: Theme, width: number, scope: PanelScope, count: number): string {
	return countsLine(theme, width, settingsSummarySegments(scope, count));
}

/** One setting row: a checkbox for booleans, the value right-aligned. */
export function settingRow(
	theme: Theme,
	width: number,
	view: SettingView,
	selected: boolean,
	editing?: { buffer: string; caret: number },
): string {
	// The editor shows the buffer with a caret block, in the accent so the row
	// reads as active rather than as a value that happens to contain a bar.
	const value = editing
		? `${editing.buffer.slice(0, editing.caret)}▏${editing.buffer.slice(editing.caret)}`
		: view.valueLabel;
	return listRow(theme, width, {
		selected,
		leading: view.kind === "boolean" ? checkbox(theme, view.value === "true") : " ",
		label: sanitizeLine(view.label),
		labelRole: selected ? "accent" : "label",
		trailing: sanitizeLine(value),
		trailingRole: editing ? "accent" : "meta",
	});
}

/** The project note: app rows are absent because Pi has no project setter. */
export function projectNote(theme: Theme, width: number): string {
	return clip(`${INDENT}${paint(theme, "faint", "App settings are Global only.")}`, width);
}

/** Where the focused row's value is written, and which scope supplied it. */
function originLine(view: SettingView, paths: { scope: WriteScope; cwd: string; agentDir: string }): string {
	const path =
		view.source === "app" ? join(paths.agentDir, PI_SETTINGS_FILE) : configPath(paths.scope, paths.cwd, paths.agentDir);
	const file = sanitizeLine(path);
	switch (view.origin) {
		case "inherited":
			return `Inherited from Global · ${file}`;
		case "project":
			return `Project · ${file}`;
		case "global":
			return `Global · ${file}`;
		default:
			return `Default · ${file}`;
	}
}

/** The focused setting's source, description, origin, and pending changes. */
export function settingDetail(options: {
	theme: Theme;
	width: number;
	view: SettingView | undefined;
	budget: number;
	dirty: boolean;
	paths: { scope: WriteScope; cwd: string; agentDir: string };
}): string[] {
	const { theme, width, view, budget, dirty, paths } = options;
	if (!view) return savedLine(theme, width, dirty);
	const source = view.source === "app" ? "Pi setting" : "bytefly.json";
	const head = `${paint(theme, "meta", sanitizeLine(view.label))} ${paint(theme, "faint", "—")} ${paint(theme, "faint", source)}`;
	const headLine = clip(`${INDENT}${head}`, width);
	// The pending-changes marker survives the collapsed body: on a short terminal
	// the value still changed, and the screen has to say so.
	const saved = savedLine(theme, width, dirty);
	if (budget === 0) return [headLine, ...saved];

	const lines = [headLine];
	const descriptionWidth = Math.max(1, width - BODY_INDENT * 2);
	const description = wrapTextWithAnsi(sanitizeLine(view.description), descriptionWidth).slice(
		0,
		Math.max(0, Math.min(2, budget - 2 - saved.length)),
	);
	for (const line of description) lines.push(clip(`${INDENT}${paint(theme, "meta", line)}`, width));
	lines.push(clip(`${INDENT}${paint(theme, "faint", originLine(view, paths))}`, width));
	lines.push(...saved);
	return lines;
}

/** The section's key hints, in the order they drop as the width runs out. */
export function settingsHints(): string[] {
	return ["Esc close", "←/→", "Space change", "Tab scope", "↑/↓ select"];
}

/** The editor's key hints: `Esc` cancels the edit, it does not close the screen. */
export function editHints(): string[] {
	return ["Esc cancel", "←/→ caret", "Enter save", "Backspace delete", "Ctrl+U clear"];
}
