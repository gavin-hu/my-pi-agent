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

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink, type Component, Text } from "@earendil-works/pi-tui";
import { formatTokens, sanitize, stripControlChars } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/ui.ts";
import { summarizeDoc } from "./paging.ts";
import { TOOL_NAME, type DocArgs, type DocResult } from "./schema.ts";

/** Keybinding id for the built-in expand toggle; never hardcode the key. */
export const EXPAND_KEYBINDING = "app.tools.expand";

/** Lines of extracted text shown in the expanded preview. */
export const PREVIEW_LINES = 20;

/** Collapse text to a single sanitized line for a transcript header. */
function oneLine(text: string): string {
	return sanitize(stripControlChars(text));
}

/** Replace a home-directory prefix with `~`, at a path boundary. */
function shortenHomePath(path: string): string {
	const normalize = (value: string): string => value.replace(/\\/g, "/");
	const home = normalize(homedir()).replace(/\/+$/, "");
	if (!home) return path;
	const normalized = normalize(path);
	if (normalized === home) return "~";
	return normalized.startsWith(`${home}/`) ? `~${normalized.slice(home.length)}` : path;
}

/** Render the argument path: accent, `~`-shortened, OSC-8 linked when supported. */
export function renderDocPath(rawPath: string | undefined, theme: Theme, cwd: string): string {
	if (typeof rawPath !== "string") return theme.fg("error", "[invalid arg]");
	const value = oneLine(rawPath);
	if (!value) return theme.fg("toolOutput", "...");
	const styled = theme.fg("accent", shortenHomePath(value));
	if (!getCapabilities().hyperlinks) return styled;
	const abs = isAbsolute(value) ? value : resolve(cwd, value);
	return hyperlink(styled, pathToFileURL(abs).href);
}

/**
 * The collapsed expand affordance: the bound key in `dim`, or nothing when the
 * binding is unknown (e.g. a non-TUI process). Built locally rather than with
 * the host `keyHint`, which colours through the global theme instead of the
 * theme passed to the renderer.
 */
export function expandHint(theme: Theme): string {
	const key = keyText(EXPAND_KEYBINDING);
	return key ? theme.fg("dim", key) : "";
}

/** First `maxLines` lines of extracted text, sanitized, plus the overflow count. */
export function previewText(text: string, maxLines: number): { body: string; moreLines: number } {
	const clean = stripControlChars(text).replace(/\t/g, "   ").replace(/\r/g, "");
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
	if (options.length > 0) text += theme.fg("toolOutput", ` (${options.join(", ")})`);
	return text;
}

/**
 * The result: a format + range summary, an expand hint when collapsed, and, when
 * expanded, a sanitized preview of the extracted text.
 */
export function formatDocResult(result: DocRenderResult, options: DocRenderOptions, theme: Theme): string {
	if (options.isPartial) return theme.fg("warning", "Reading...");

	const isError = result.isError ?? false;
	const details = result.details as DocResult | undefined;

	if (!details || isError) {
		const first = result.content[0];
		const message = first?.type === "text" && first.text ? first.text : "Read failed";
		const safe = oneLine(message.startsWith("Error:") ? message : `Error: ${message}`);
		return theme.fg("error", safe);
	}

	const summary = summarizeDoc(details);
	const sep = theme.fg("dim", SEPARATORS.item);
	let text = theme.fg("muted", summary.format) + sep + theme.fg("toolOutput", summary.detail);
	if (summary.note) text += theme.fg(summary.truncated ? "accent" : "dim", SEPARATORS.item + summary.note);

	if (details.text.length > 0) {
		if (options.expanded) {
			const { body, moreLines } = previewText(details.text, PREVIEW_LINES);
			text += `\n${theme.fg("toolOutput", body)}`;
			if (moreLines > 0) text += `\n${theme.fg("muted", `... (${moreLines} more lines)`)}`;
		} else {
			const hint = expandHint(theme);
			if (hint) text += theme.fg("muted", SEPARATORS.item) + hint;
		}
	}

	return text;
}

/** Reuse the slot's previous `Text` component, or allocate one. */
export function reuseText(lastComponent: Component | undefined, text: string): Text {
	const component = lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
	component.setText(text);
	return component;
}
