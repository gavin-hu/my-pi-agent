/**
 * The focused row's block: what the list row cannot say.
 *
 * One function, because the block is the same thing in both layouts — beside the
 * list on a wide terminal, under it on a narrow one — and one owner is what keeps
 * the two from drifting. It also draws the key table `?` swaps in, so help needs
 * no layout of its own.
 *
 * Pure: the theme, the row and the paths come in, lines come out, already clipped
 * to the width they were given.
 */

import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../../lib/format.ts";
import { clip, clipMiddle } from "../../../../lib/tui/columns.ts";
import { BODY_INDENT } from "../../../../lib/tui/indent.ts";
import { keyValueRow } from "../../../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../../../lib/tui/tokens.ts";
import { detailLines as reportDetailLines, reportSummary, reportSeverity, severityRole } from "../../doctor/format.ts";
import { rowBadge } from "../format.ts";
import type { SettingView } from "../settings.ts";
import { configPath } from "../settings-runtime.ts";
import type { PanelRow, PanelSection } from "../types.ts";
import { INDENT, savedLine } from "./frame.ts";
import { helpRows } from "./keys.ts";

/** Pi's personal settings file, named where a setting is stored there. */
const PI_SETTINGS_FILE = "settings.json";

/** Columns the fact labels take before their value. */
const FACT_LABEL_WIDTH = 11;

/** Where a value is written, and which file supplied the one on screen. */
export interface SidePaths {
	scope: "global" | "project";
	cwd: string;
	agentDir: string;
}

/** What the block needs to know. */
export interface SideInput {
	theme: Theme;
	width: number;
	section: PanelSection;
	/** The focused resource row, on a list section. */
	row?: PanelRow;
	/** The group heading the row sits under, as the list named it. */
	groupLabel?: string;
	/** The focused setting, on Settings. */
	setting?: SettingView;
	/** Draw the key table instead of the focused row's facts. */
	help: boolean;
	/** The focused row's findings are expanded. */
	expanded: boolean;
	/**
	 * The block is drawn under the list, in the space of a few rows, instead of
	 * beside it: the row directly above already carries the name, the verdict and
	 * the value, so only what it cannot say is worth the rows.
	 */
	compact?: boolean;
	/** Something was changed this session. */
	dirty: boolean;
	paths: SidePaths;
	/** The stored `bytefly.json` section, when the JSON pane is open. */
	json?: { section: string; document: unknown };
}

/**
 * One fact line whose value is a path: the file's own name is what identifies it,
 * so the middle goes first and both ends stay.
 */
function pathFact(theme: Theme, width: number, label: string, value: string): string {
	// Sanitize first, then clip: the clipper inserts its own reset sequence, and
	// running a sanitizer over that would leave half of it on screen.
	const room = Math.max(8, width - BODY_INDENT - FACT_LABEL_WIDTH);
	return factCell(theme, width, label, clipMiddle(sanitizeLine(value), room), "meta");
}

/** One fact line: a label column and its value. */
function fact(theme: Theme, width: number, label: string, value: string, role: TuiRole = "label"): string {
	return factCell(theme, width, label, sanitizeLine(value), role);
}

/** The fact line itself, for a value that is already sanitized and clipped. */
function factCell(theme: Theme, width: number, label: string, value: string, role: TuiRole): string {
	return keyValueRow(theme, width, {
		label,
		value,
		labelWidth: FACT_LABEL_WIDTH,
		labelRole: "faint",
		valueRole: role,
	});
}

/** A faint `── label ─────` divider inside the block. */
function blockRule(theme: Theme, width: number, label: string): string {
	const text = ` ${label} `;
	const room = Math.max(0, width - BODY_INDENT - text.length);
	return clip(
		`${" ".repeat(BODY_INDENT)}${paint(theme, "faint", `${"─".repeat(Math.min(2, room))}${text}${"─".repeat(Math.max(0, room - 2))}`)}`,
		width,
	);
}

/** A description, wrapped and indented under a label of its own. */
function description(theme: Theme, width: number, label: string, text: string, rows: number): string[] {
	const room = Math.max(1, width - BODY_INDENT);
	const wrapped = wrapTextWithAnsi(sanitizeLine(text), room).slice(0, Math.max(1, rows));
	const lines = [clip(`${INDENT}${paint(theme, "faint", label)}`, width)];
	for (const line of wrapped) lines.push(clip(`${INDENT}${paint(theme, "meta", line)}`, width));
	return lines;
}

/** The focused resource's name and verdict, then its facts and findings. */
function resourceRows(input: SideInput): string[] {
	const { theme, width, row, groupLabel } = input;
	const lines: string[] = [];
	if (row === undefined) return lines;
	const compact = input.compact === true;
	const badge = rowBadge(row);
	if (!compact) {
		const head = paint(theme, "accent", sanitizeLine(row.label));
		const verdict = badge.text === undefined ? "" : ` ${paint(theme, badge.role, sanitizeLine(badge.text))}`;
		lines.push(clip(`${INDENT}${head}${verdict}`, width));
	}

	// A skill carries what its own file declares; an extension carries the doctor's
	// findings. Neither invents the other's facts.
	const path = row.item?.path ?? row.report?.extension;
	const report = row.report;
	const findings =
		report === undefined ? [] : reportDetailLines(report, theme, width, compact ? 20 : 40, input.expanded);

	// Findings first: in the narrow layout they are the reason the block exists, and
	// the row above already says the name. `Path` is the fallback — what a row with
	// nothing to report still cannot say.
	if (findings.length === 0 && compact && path !== undefined) lines.push(pathFact(theme, width, "Path", path));
	if (findings.length > 0) {
		if (!compact) lines.push(blockRule(theme, width, "findings"));
		lines.push(...findings);
	}
	if (compact) return [...lines, ...savedLine(theme, width, input.dirty)];

	if (path !== undefined) lines.push(pathFact(theme, width, "Path", path));
	if (groupLabel !== undefined) lines.push(fact(theme, width, "Source", groupLabel, "meta"));
	if (row.item !== undefined) {
		lines.push(fact(theme, width, "State", row.item.enabled ? "enabled" : "off", "meta"));
	}

	// A skill carries what its own file declares; an extension carries the doctor's
	// findings. Neither invents the other's facts.
	const skill = row.skill;
	if (skill !== undefined && !compact) {
		if (skill.name !== undefined) lines.push(fact(theme, width, "Call", `/skill:${skill.name}`, "meta"));
		if (skill.modelHidden) lines.push(fact(theme, width, "Model", "hidden from the model", "warn"));
		if (skill.problem !== undefined) lines.push(fact(theme, width, "Problem", skill.problem, "warn"));
		if (skill.description !== "") {
			lines.push(...description(theme, width, "About", skill.description, input.expanded ? 6 : 2));
		}
	}
	if (report !== undefined) {
		lines.push(fact(theme, width, "Health", reportSummary(report), severityRole(reportSeverity(report))));
	}
	lines.push(...savedLine(theme, width, input.dirty));
	return lines;
}

/** Where a setting's value is written, and which scope supplied the one shown. */
function originLine(view: SettingView, paths: SidePaths): string {
	const scope = view.origin === "inherited" ? "global" : paths.scope;
	const file =
		view.source === "app" ? join(paths.agentDir, PI_SETTINGS_FILE) : configPath(scope, paths.cwd, paths.agentDir);
	const origin =
		view.origin === "inherited"
			? "Inherited from Global"
			: view.origin === "project"
				? "Project"
				: view.origin === "global"
					? "Global"
					: "Default";
	return `${origin} · ${file}`;
}

/** The focused setting's sentence, its origin, and the `bytefly.json` section behind it. */
function settingRows(input: SideInput): string[] {
	const { theme, width, setting } = input;
	const lines: string[] = [];
	if (setting === undefined) return lines;
	const compact = input.compact === true;
	if (!compact) {
		lines.push(clip(`${INDENT}${paint(theme, "accent", sanitizeLine(setting.label))}`, width));
		lines.push(fact(theme, width, "Now", setting.valueLabel, "label"));
	}
	lines.push(...description(theme, width, "About", setting.description, input.expanded ? 6 : compact ? 1 : 2));
	lines.push(pathFact(theme, width, "Stored in", originLine(setting, input.paths)));
	const json = input.json;
	if (json !== undefined && setting.config !== undefined) {
		lines.push(blockRule(theme, width, json.section));
		lines.push(...jsonLines(theme, width, json.document));
	}
	lines.push(...savedLine(theme, width, input.dirty));
	return lines;
}

/** The stored section as JSON, clipped by the caller like any other block. */
function jsonLines(theme: Theme, width: number, document: unknown): string[] {
	if (document === undefined) return [clip(`${INDENT}${paint(theme, "faint", "Not set in this scope.")}`, width)];
	return JSON.stringify(document, null, 2)
		.split("\n")
		.map((line) => clip(`${INDENT}${paint(theme, "faint", sanitizeLine(line))}`, width));
}

/**
 * The block the focused row gets, in either layout. Empty when nothing is focused,
 * so a caller can compose rows without a special case.
 */
export function sideRows(input: SideInput): string[] {
	const { theme, width, section } = input;
	if (input.help) return helpRows(theme, width, section);
	if (section === "settings") return settingRows(input);
	return resourceRows(input);
}
