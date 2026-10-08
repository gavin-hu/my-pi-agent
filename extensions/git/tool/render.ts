/**
 * Transcript rendering for the read-only `git` tool.
 *
 * Pure over the call args and the result: `renderGitCall` previews the effective
 * invocation before execution, and `renderGitResult` draws a truncated preview
 * (green-free `dim` on success, `error` on failure). Keeping this out of
 * `index.ts` leaves registration and execution in one place.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import type { GitArgs } from "./schema.ts";

/** Lines of output shown in an unexpanded result. */
const PREVIEW_LINES = 12;

/** Cap `text` at {@link PREVIEW_LINES} lines unless `expanded`. */
export function preview(text: string, expanded: boolean): string {
	const lines = text.split("\n");
	if (expanded || lines.length <= PREVIEW_LINES) return text;
	return [...lines.slice(0, PREVIEW_LINES), `… ${lines.length - PREVIEW_LINES} more lines`].join("\n");
}

/**
 * Render the effective invocation from the call args, for example
 * `git diff --cached --stat` or `git log -n5 main -- src`. Built from args
 * rather than the authoritative argv so a malformed call still renders;
 * execution reports the validation error separately.
 */
export function renderGitCall(args: GitArgs, theme: Theme): Component {
	const action = typeof args?.action === "string" ? args.action : "";
	const parts: string[] = [];
	if (action) parts.push(action);
	if (args?.staged) parts.push("--cached");
	if (args?.stat) parts.push("--stat");
	if (args?.limit !== undefined) parts.push(`-n${args.limit}`);
	if (args?.ref) parts.push(args.ref);
	if (args?.path) parts.push("--", args.path);
	return new Text(theme.fg("toolTitle", theme.bold("git ")) + theme.fg("muted", parts.join(" ")), 0, 0);
}

/** Render a tool result as a truncated preview, colored by success or failure. */
export function renderGitResult(
	result: AgentToolResult<unknown>,
	options: { expanded: boolean },
	theme: Theme,
): Component {
	const content = result.content[0];
	const text = content?.type === "text" ? content.text : "";
	const color = result.isError ? "error" : "dim";
	return new Text(theme.fg(color, preview(text, options.expanded)), 0, 0);
}
