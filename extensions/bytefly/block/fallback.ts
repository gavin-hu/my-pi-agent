/**
 * Generic call and result fallbacks for a tool with no renderer of its own.
 *
 * Pi's own fallback is only used when nothing resolves a renderer; because the
 * resolver returns one for every tool, a tool like an MCP call with no renderer
 * would otherwise be framed around nothing. These mirror Pi's
 * `formatToolCallWithArgs` / text preview closely enough to read the same, and
 * every value is sanitized at the boundary.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripControlChars } from "../../../lib/format.ts";
import { paint } from "../../../lib/tui/tokens.ts";

/** Collapsed argument preview length, matching Pi's generic call header. */
const COLLAPSED_ARGS_CHARS = 100;

/** Result lines shown before the rest collapse into a note. */
const FALLBACK_PREVIEW_LINES = 10;

/** A call line for a tool with no renderer: the bold title, then its arguments. */
export function callFallback(toolName: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = theme.fg("toolTitle", theme.bold(toolName));
	if (args == null) return header;
	const entries: Array<[string, unknown]> =
		typeof args === "object" && !Array.isArray(args)
			? Object.entries(args as Record<string, unknown>)
			: [["args", args]];
	if (entries.length === 0) return header;
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${stripControlChars(text).split("\n").join("\n    ")}`;
		});
		return `${header}\n${paint(theme, "meta", lines.join("\n"))}`;
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	const preview = pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return `${header} ${paint(theme, "meta", preview)}`;
}

/** A result preview for a tool with no renderer: its text, capped when collapsed. */
export function resultFallback(
	content: readonly { type: string; text?: string }[],
	theme: Theme,
	expanded: boolean,
): string {
	const text = content
		.filter((block) => block.type === "text")
		.map((block) => stripControlChars(block.text ?? ""))
		.join("\n");
	if (!text) return "";
	const lines = text.split("\n");
	const shown = expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
	let output = theme.fg("toolOutput", shown.join("\n"));
	const remaining = lines.length - shown.length;
	if (remaining > 0) output += `\n${paint(theme, "meta", `... (${remaining} more lines)`)}`;
	return output;
}
