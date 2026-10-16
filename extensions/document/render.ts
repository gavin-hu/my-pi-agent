/**
 * Transcript rendering for `read_doc`.
 *
 * Theme-aware formatting only: the tool definition in `tool.ts` wires these to
 * `renderCall` / `renderResult`. The call line carries the path (accent,
 * `~`-shortened, OSC-8 linked when the terminal supports it); the result line
 * leads with the format and a humanized range, so the path is never repeated.
 * The expanded view appends a sanitized, line-capped preview of the extracted
 * text. Every field is sanitized before a theme colour is applied.
 */

import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";
import { formatTokens, sanitizeLine, shortenPath, stripControlChars } from "../../lib/format.ts";
import { expandKey, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { summarizeDoc } from "./paging.ts";
import { TOOL_NAME, type DocArgs, type DocResult } from "./schema.ts";

/** Lines of extracted text shown in the expanded preview. */
export const PREVIEW_LINES = 20;

/** Render the argument path: accent, `~`-shortened, OSC-8 linked when supported. */
export function renderDocPath(rawPath: string | undefined, theme: Theme, cwd: string): string {
	if (typeof rawPath !== "string") return paint(theme, "bad", "[invalid arg]");
	const value = sanitizeLine(rawPath);
	if (!value) return theme.fg("toolOutput", "...");
	const styled = paint(theme, "accent", shortenPath(value));
	if (!getCapabilities().hyperlinks) return styled;
	const abs = isAbsolute(value) ? value : resolve(cwd, value);
	return hyperlink(styled, pathToFileURL(abs).href);
}

/** First `maxLines` lines of extracted text, sanitized, plus the overflow count. */
export function previewText(text: string, maxLines: number): { body: string; moreLines: number } {
	const clean = stripControlChars(text).replace(/\t/g, "   ");
	const lines = clean.split("\n");
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") end--;
	const trimmed = lines.slice(0, end);
	const shown = trimmed.slice(0, maxLines);
	return { body: shown.join("\n"), moreLines: trimmed.length - shown.length };
}

/** A result shape broad enough for both a test double and the host. */
export interface DocRenderResult {
	content: ReadonlyArray<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
}

/** Options the host passes to `renderResult`. */
export interface DocRenderOptions {
	expanded: boolean;
	isPartial: boolean;
}

/** The call line: `read_doc <path> (from N, max M)`. */
export function formatDocCall(args: DocArgs, theme: Theme, context: { cwd: string }): string {
	const { path, startIndex, maxChars } = args;
	let text = theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + renderDocPath(path, theme, context.cwd);
	const options: string[] = [];
	if (typeof startIndex === "number" && startIndex > 0) options.push(`from ${formatTokens(startIndex)}`);
	if (typeof maxChars === "number") options.push(`max ${formatTokens(maxChars)}`);
	if (options.length > 0) text += paint(theme, "faint", ` (${options.join(", ")})`);
	return text;
}

/**
 * The result: a format + range summary, an expand hint when collapsed, and, when
 * expanded, a sanitized preview of the extracted text.
 */
export function formatDocResult(result: DocRenderResult, options: DocRenderOptions, theme: Theme): string {
	if (options.isPartial) return paint(theme, "warn", "Reading...");

	const isError = result.isError ?? false;
	const details = result.details as DocResult | undefined;

	if (!details || isError) {
		const first = result.content[0];
		const message = first?.type === "text" && first.text ? first.text : "Read failed";
		const safe = sanitizeLine(message.startsWith("Error:") ? message : `Error: ${message}`);
		return paint(theme, "bad", safe);
	}

	const summary = summarizeDoc(details);
	const sep = paint(theme, "faint", SEPARATORS.item);
	let text = paint(theme, "meta", summary.format) + sep + theme.fg("toolOutput", summary.detail);
	if (summary.note) text += paint(theme, summary.truncated ? "accent" : "faint", SEPARATORS.item + summary.note);

	if (details.text.length > 0) {
		if (options.expanded) {
			const { body, moreLines } = previewText(details.text, PREVIEW_LINES);
			// Blank line before the body, matching the built-ins' header/output gap.
			text += `\n\n${theme.fg("toolOutput", body)}`;
			if (moreLines > 0) text += `\n${paint(theme, "meta", `... (${moreLines} more lines)`)}`;
		} else {
			const hint = expandKey(theme);
			if (hint) text += paint(theme, "meta", SEPARATORS.item) + hint;
		}
	}

	return text;
}
