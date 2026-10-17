/**
 * Generic call and result fallbacks for a tool with no renderer of its own.
 *
 * Pi's own fallback is only used when nothing resolves a renderer; because the
 * resolver returns one for every tool, a tool like an MCP call with no renderer
 * would otherwise be framed around nothing. These mirror how the built-ins read
 * — a bare subject, then any options — so the block reads like the rest of the
 * transcript instead of a raw argument dump, and every value is sanitized at the
 * boundary.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeLine, stripControlChars } from "../../../lib/format.ts";
import { paint } from "../../../lib/tui/tokens.ts";
import { toolCallTitle } from "../../../lib/tui/tool.ts";

/** Collapsed argument preview length, matching Pi's generic call header. */
const COLLAPSED_ARGS_CHARS = 100;

/** Result lines shown before the rest collapse into a note. */
const FALLBACK_PREVIEW_LINES = 10;

/** Split top-level arguments into key/value pairs, in insertion order. */
function argumentEntries(args: unknown): Array<[string, unknown]> {
	if (typeof args === "object" && args !== null && !Array.isArray(args)) {
		return Object.entries(args as Record<string, unknown>);
	}
	return [["args", args]];
}

/**
 * The argument shown bare after the tool name, the way a built-in names its
 * subject (`read src/cli.ts:1-8`). Only a non-empty string qualifies, so an
 * option never loses its key; one with spaces is quoted so it stays one value.
 */
function subjectValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = sanitizeLine(value);
	if (!text) return undefined;
	return /\s/.test(text) ? JSON.stringify(text) : text;
}

/**
 * One option fragment: `key value`, a bare `key` for a true flag, or undefined
 * when the value carries nothing (a false flag, null, or an empty string).
 */
function optionFragment(key: string, value: unknown): string | undefined {
	if (value === undefined || value === null || value === false || value === "") return undefined;
	const name = sanitizeLine(key);
	if (value === true) return name;
	if (typeof value === "string") return `${name} ${subjectValue(value) ?? ""}`.trimEnd();
	if (typeof value === "number" || typeof value === "bigint") return `${name} ${value}`;
	return `${name} ${sanitizeLine(JSON.stringify(value) ?? String(value))}`;
}

/**
 * A call line for a tool with no renderer: the bold title, then its leading
 * string argument (when there is one) and the remaining options in parentheses,
 * matching the built-ins' `read <path>` / `ls <path> (limit 500)` grammar. The
 * subject reads in the body colour — the tool name is the call's only accent —
 * and the options stay faint.
 */
export function callFallback(toolName: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = toolCallTitle(theme, toolName);
	if (args == null) return header;
	const entries = argumentEntries(args);
	if (entries.length === 0) return header;
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${sanitizeLine(key)}: ${stripControlChars(text).split("\n").join("\n    ")}`;
		});
		return `${header}\n${paint(theme, "meta", lines.join("\n"))}`;
	}

	let subject: string | undefined;
	const options: string[] = [];
	for (const [key, value] of entries) {
		if (subject === undefined) {
			const candidate = subjectValue(value);
			if (candidate !== undefined) {
				subject = candidate;
				continue;
			}
		}
		const option = optionFragment(key, value);
		if (option !== undefined) options.push(option);
	}

	// With a subject the options read as a trailing aside; without one (a flag or
	// no arguments at all) they stand on their own.
	const body =
		subject !== undefined ? `${subject}${options.length > 0 ? ` (${options.join(", ")})` : ""}` : options.join(" ");
	if (!body) return header;
	const preview = body.length > COLLAPSED_ARGS_CHARS ? `${body.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : body;
	if (subject === undefined) return `${header} ${paint(theme, "faint", preview)}`;
	// Colour the subject and the options apart, after the preview clip, so a
	// clipped subject never strands an unterminated escape.
	const subjectPart = preview.slice(0, Math.min(subject.length, preview.length));
	const optionsPart = preview.slice(subjectPart.length);
	return `${header} ${paint(theme, "label", subjectPart)}${optionsPart ? paint(theme, "faint", optionsPart) : ""}`;
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
