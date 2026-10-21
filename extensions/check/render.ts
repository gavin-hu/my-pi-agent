/**
 * The `run_check` transcript block.
 *
 * The `/check` screens live in `tui.ts` and the model report in `format.ts`;
 * this is the one result a session keeps inline. It is a capped view of the same
 * `details`: a status line, the first few failures, and the bounded tail when
 * nothing parsed. The transcript never prints the model report, and `/check`
 * remains the full navigable list.
 *
 * Every field comes from command output, a manifest script name, or project
 * config, so each is sanitized before the theme is applied.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../lib/format.ts";
import { clip } from "../../lib/tui/columns.ts";
import { expandHint, GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { listRow } from "../../lib/tui/rows.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import { earlierHint } from "../../lib/tui/tool.ts";
import { MODEL_FAILURES, formatFailureLine, formatResultSummary, hasFailureLocation } from "./format.ts";
import type { Failure, RunCheckDetails } from "./types.ts";

/** Failure rows a collapsed transcript result shows. */
export const COLLAPSED_ROWS = 5;
/** Tail lines a collapsed unparsed result shows. */
export const COLLAPSED_TAIL_ROWS = 5;

/** The design role a check status is drawn in. */
function statusRole(status: RunCheckDetails["status"]): TuiRole {
	switch (status) {
		case "passed":
			return "ok";
		case "failed":
		case "error":
			return "bad";
		case "timeout":
			return "warn";
		case "cancelled":
			return "meta";
		case "running":
			return "info";
	}
}

/** Width-1 glyph for a check status, from the shared vocabulary. */
function statusGlyph(status: RunCheckDetails["status"]): string {
	switch (status) {
		case "passed":
			return GLYPHS.check;
		case "failed":
			return GLYPHS.jobsFailure;
		case "timeout":
			return GLYPHS.warn;
		case "cancelled":
			return GLYPHS.stopped;
		case "error":
			return GLYPHS.cross;
		case "running":
			return GLYPHS.jobsRunning;
	}
}

/**
 * The summary line: the screen's wording plus the two facts it leaves to a
 * detail row, the exit code of an unparsed failure and a dropped log prefix.
 */
function formatStatusSummary(details: RunCheckDetails): string {
	const text = formatResultSummary(details);
	const extras: string[] = [];
	const parsed = details.failures.some(hasFailureLocation);
	if (!parsed && (details.status === "failed" || details.status === "timeout") && details.exitCode !== null) {
		extras.push(`exit ${details.exitCode}`);
	}
	if (details.truncated) extras.push("log truncated");
	return extras.length === 0 ? text : `${text}${SEPARATORS.item}${extras.join(SEPARATORS.item)}`;
}

/** One parsed failure: its location and reason, plus its command when several ran. */
function failureRow(failure: Failure, theme: Theme, width: number, showCommand: boolean): string {
	const command = showCommand ? `${SEPARATORS.item}${sanitizeLine(failure.command)}` : "";
	return listRow(theme, width, {
		marker: false,
		glyph: GLYPHS.jobsFailure,
		glyphRole: "bad",
		label: `${formatFailureLine(failure)}${command}`,
		labelRole: "label",
	});
}

/** A command that failed without a parseable location, named by its command. */
function unparsedRow(failure: Failure, theme: Theme, width: number): string {
	return listRow(theme, width, {
		marker: false,
		glyph: GLYPHS.jobsFailure,
		glyphRole: "bad",
		label: `${sanitizeLine(failure.command)}${SEPARATORS.item}${sanitizeLine(failure.message)}`,
		labelRole: "meta",
	});
}

/** `… N more failures`, pointing at the expand key or at `/check`. */
function moreFailures(theme: Theme, width: number, hidden: number, expandable: boolean): string {
	const note = paint(theme, "faint", `… ${hidden} more failure${hidden === 1 ? "" : "s"}`);
	const next = expandable ? expandHint(theme) : paint(theme, "faint", "/check lists all");
	return clip(`${note} ${next}`, width);
}

/** The bounded tail, newest lines last, with the number dropped by the collapse. */
function tailLines(tail: string, theme: Theme, width: number, expanded: boolean): string[] {
	const all = tail.split("\n").map((line) => sanitizeLine(line).replaceAll("\t", "    "));
	while (all.length > 0 && all[all.length - 1] === "") all.pop();
	const shown = expanded ? all : all.slice(Math.max(0, all.length - COLLAPSED_TAIL_ROWS));
	const lines: string[] = [];
	if (shown.length < all.length) {
		lines.push(clip(earlierHint(theme, all.length - shown.length, "lines"), width));
	}
	for (const line of shown) lines.push(clip(paint(theme, "label", line), width));
	return lines;
}

/** What a result block draws: the run's details and whether the view is expanded. */
export interface CheckResultInput {
	details: RunCheckDetails;
	expanded: boolean;
}

/**
 * The transcript result: one status line, then parsed failures up to the cap,
 * then the bounded tail when nothing parsed. Reused across renders so the
 * transcript updates it in place.
 */
export class CheckResultBlock implements Component {
	private input: CheckResultInput;
	private theme: Theme;

	constructor(input: CheckResultInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: CheckResultInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const w = Math.max(1, width);
		const theme = this.theme;
		const { details, expanded } = this.input;
		const role = statusRole(details.status);
		const lines = [
			clip(`${paint(theme, role, statusGlyph(details.status))} ${paint(theme, role, formatStatusSummary(details))}`, w),
		];

		const parsed = details.failures.filter(hasFailureLocation);
		const unparsed = details.failures.filter((failure) => !hasFailureLocation(failure));
		const limit = expanded ? MODEL_FAILURES : COLLAPSED_ROWS;
		const shown = parsed.slice(0, limit);
		for (const failure of shown) {
			lines.push(failureRow(failure, theme, w, details.commands.length > 1));
		}
		if (parsed.length > shown.length) {
			lines.push(moreFailures(theme, w, parsed.length - shown.length, !expanded));
		}
		// A command that failed without a location is named after the parsed rows;
		// when no row parsed at all, the tail is the honest evidence instead.
		if (parsed.length > 0) {
			for (const failure of unparsed) lines.push(unparsedRow(failure, theme, w));
			return lines;
		}

		const tail = details.tail ?? "";
		if (details.status === "passed" || details.status === "error" || tail.trim() === "") return lines;
		lines.push(
			clip(paint(theme, "meta", details.status === "failed" ? "no parsed failure; last output:" : "last output:"), w),
		);
		lines.push(...tailLines(tail, theme, w, expanded));
		return lines;
	}
}
