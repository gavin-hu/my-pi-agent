/**
 * Model-facing registration for the `memory` tool.
 *
 * One singleton tool with an action switch, like `job`: `add` and `forget`
 * mutate one scope, `list` reads both. Validation failures come back as an error
 * result carrying the unchanged notes, so the model can retry without
 * corrupting a store.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatCallText, formatResultText, scopeLabel } from "./format.ts";
import type { MemoryRuntime } from "./runtime.ts";
import {
	MemoryParams,
	MemoryResult,
	normalizeAction,
	normalizeEntryText,
	normalizeScope,
	type MemoryArgs,
} from "./schema.ts";
import type { MemoryDetails, MemoryScope } from "./types.ts";

export const TOOL_NAME = "memory";

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** JSON-safe mirror of the details for `structuredContent`. */
function toStructuredContent(details: MemoryDetails): Record<string, JsonValue> {
	const content: Record<string, JsonValue> = {
		action: details.action,
		scope: details.scope,
		project: details.project,
		global: details.global,
		changed: details.changed,
	};
	if (details.entry !== undefined) content.entry = details.entry;
	if (details.error !== undefined) content.error = details.error;
	return content;
}

/**
 * Build the tool result for one call. A rejected call carries the unchanged
 * notes and is marked `isError`; nothing was written.
 */
function memoryResult(details: MemoryDetails, error?: string) {
	const full: MemoryDetails = error === undefined ? details : { ...details, error };
	return {
		content: [{ type: "text" as const, text: formatResultText(full) }],
		details: full,
		structuredContent: toStructuredContent(full),
		...(error === undefined ? {} : { isError: true as const }),
	};
}

export function registerTools(pi: ExtensionAPI, runtime: MemoryRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Memory",
		description: [
			"Save, remove, or list short durable notes that are recalled automatically in later sessions.",
			'Notes are scoped "project" (the current repository, the default) or "global" (every project).',
			"Stored notes are injected into context before each run, so you do not need to read them back;",
			"use action list only to inspect a store, and pass a note's exact text to action forget to remove it.",
		].join(" "),
		promptSnippet: "Save or remove a durable note that is recalled in later sessions.",
		promptGuidelines: [
			"Use memory for short, durable facts the user asks you to remember; keep one fact per call.",
			'Use scope "global" for cross-project facts and "project" (the default) for repo-specific ones.',
			"Stored notes are injected automatically; call memory with action list only to see what is stored.",
			"To remove a note, pass its exact text with action forget. Bulk clearing is not available through the tool.",
		],
		parameters: MemoryParams,
		outputSchema: MemoryResult,
		exposure: "direct",
		defaultActive: true,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate) {
			const args = params as MemoryArgs;
			let action: MemoryDetails["action"];
			let scope: MemoryScope;
			try {
				action = normalizeAction(args.action);
				scope = normalizeScope(args.scope);
			} catch (error) {
				return memoryResult(
					{ action: "list", scope: "project", ...runtime.entries(), changed: false },
					messageOf(error),
				);
			}

			try {
				if (action === "list") {
					return memoryResult({ action, scope, ...runtime.entries(), changed: false });
				}
				const text = normalizeEntryText(args.text);
				if (action === "add") {
					const changed = await runtime.add(scope, text);
					return memoryResult({ action, scope, ...runtime.entries(), changed, entry: text });
				}
				const changed = await runtime.forget(scope, text);
				if (!changed) {
					return memoryResult(
						{ action, scope, ...runtime.entries(), changed: false, entry: text },
						`No ${scopeLabel(scope)} memory note matches: ${text}`,
					);
				}
				return memoryResult({ action, scope, ...runtime.entries(), changed, entry: text });
			} catch (error) {
				return memoryResult({ action, scope, ...runtime.entries(), changed: false }, messageOf(error));
			}
		},

		renderCall(args, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const body = formatCallText(args as { action?: unknown; text?: unknown; scope?: unknown }, context.argsComplete);
			text.setText(theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) + theme.fg("muted", body));
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as MemoryDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.error) {
				text.setText(theme.fg("error", `Error: ${details.error}`));
				return text;
			}
			text.setText(formatResultText(details, expanded));
			return text;
		},
	});
}
