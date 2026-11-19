/**
 * Model-facing registration for the `memory` tool.
 *
 * One singleton tool with an action switch, like `job`: `add`, `update`, and
 * `forget` mutate one scope, `list` reads both. Validation failures come back as
 * an error result carrying the unchanged notes, so the model can retry without
 * corrupting a store. An `add` that duplicates an existing note is a no-op that
 * names the stored note.
 */

import type { JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callLine, detailsOrLine } from "../../lib/tui/tool.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { messageOf } from "./errors.ts";
import { formatCallText, formatResultText, scopeLabel } from "./format.ts";
import type { MemoryRuntime } from "./runtime.ts";
import {
	MemoryParams,
	MemoryResult,
	normalizeAction,
	normalizeEntryText,
	normalizeNoteSelector,
	normalizeScope,
	type MemoryArgs,
} from "./schema.ts";
import { noteLabel, type MemoryDetails, type MemoryScope } from "./types.ts";

export const TOOL_NAME = "memory";

/** The notes as a reader sees them: `[jack] text`, or the bare text of an unattributed one. */
function labelled(runtime: MemoryRuntime): { project: string[]; global: string[] } {
	const entries = runtime.entries();
	return { project: entries.project.map(noteLabel), global: entries.global.map(noteLabel) };
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
	if (details.to !== undefined) content.to = details.to;
	if (details.second !== undefined) content.second = details.second;
	if (details.existing !== undefined) content.existing = details.existing;
	if (details.error !== undefined) content.error = details.error;
	return content;
}

/**
 * Build the tool result for one call. A rejected call carries the unchanged
 * notes and is marked `isError`; nothing was written.
 */
function memoryResult(details: MemoryDetails, error?: string) {
	const full: MemoryDetails = error === undefined ? details : { ...details, error };
	const text = formatResultText(full, true);
	const structuredContent = toStructuredContent(full);
	return error === undefined ? textResult(text, full, structuredContent) : failedResult(text, full, structuredContent);
}

export function registerTools(pi: ExtensionAPI, runtime: MemoryRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Memory",
		description: [
			"Save, change, remove, or list short durable notes that are recalled automatically in later sessions.",
			'Notes are scoped "project" (the current repository, the default) or "global" (every project); stored notes',
			"are injected into context before each run. Adding a note that already exists, ignoring case and trailing",
			"punctuation, is a no-op.",
		].join(" "),
		promptSnippet: "Save, change, or remove a durable note that is recalled in later sessions.",
		promptGuidelines: [
			"Use memory for short, durable facts the user asks you to remember; keep one fact per call.",
			"Consolidate two notes with action merge (first, second, merged) rather than forgetting and re-adding them.",
			"Use action list only to see what is stored; the notes are already in context.",
			"To remove a note, pass its exact text with action forget; bulk clearing is not available.",
			"To change a note, use action update with its exact text and the replacement in to; do not forget and re-add.",
		],
		parameters: MemoryParams,
		outputSchema: MemoryResult,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate) {
			// The notes in hand before the action reads them: a tool call can arrive before the
			// session's store read has landed, and an empty store would read as "no notes".
			await runtime.ready();
			const args = params as MemoryArgs;
			let action: MemoryDetails["action"];
			let scope: MemoryScope;
			try {
				action = normalizeAction(args.action);
				scope = normalizeScope(args.scope);
			} catch (error) {
				return memoryResult(
					{ action: "list", scope: "project", ...labelled(runtime), changed: false },
					messageOf(error),
				);
			}

			try {
				if (action === "list") {
					return memoryResult({ action, scope, ...labelled(runtime), changed: false });
				}
				if (action === "merge") {
					const first = normalizeNoteSelector(args.first, "first");
					const second = normalizeNoteSelector(args.second, "second");
					const merged = normalizeEntryText(args.merged, "merged");
					if (first === second) {
						// The store's transform would answer false for a note merged with itself, and
						// the message would claim two notes were missing. Refuse it as what it is.
						return memoryResult(
							{ action, scope, ...labelled(runtime), changed: false, entry: first, second },
							`A merge needs two different notes; "${first}" was named twice.`,
						);
					}
					const changed = await runtime.merge(scope, first, second, merged);
					if (!changed) {
						return memoryResult(
							{ action, scope, ...labelled(runtime), changed: false, entry: first, to: merged, second },
							`No ${scopeLabel(scope)} memory notes match both "${first}" and "${second}".`,
						);
					}
					return memoryResult({ action, scope, ...labelled(runtime), changed, entry: first, to: merged, second });
				}
				const text = action === "add" ? normalizeEntryText(args.text) : normalizeNoteSelector(args.text);
				if (action === "add") {
					const result = await runtime.add(scope, text);
					return memoryResult({
						action,
						scope,
						...labelled(runtime),
						changed: result.changed,
						entry: text,
						...(result.existing === undefined ? {} : { existing: result.existing }),
					});
				}
				if (action === "update") {
					const to = normalizeEntryText(args.to, "to");
					// Equal text says nothing about the store, so the read decides: "already set"
					// is only true for a note this scope holds, and the store may hold it in the
					// other scope or lack it entirely.
					const notes = labelled(runtime);
					if (text === to && notes[scope].includes(text)) {
						return memoryResult({ action, scope, ...notes, changed: false, entry: text, to });
					}
					const changed = await runtime.update(scope, text, to);
					if (!changed) {
						// `update` refuses an untrusted project before it writes, so a miss that
						// reaches here is real: name the other scope when that is why it missed.
						const other: MemoryScope = scope === "project" ? "global" : "project";
						const elsewhere = notes[other].includes(text) ? ` (it is in ${scopeLabel(other)} memory)` : "";
						return memoryResult(
							{ action, scope, ...notes, changed: false, entry: text, to },
							`No ${scopeLabel(scope)} memory note matches: ${text}${elsewhere}`,
						);
					}
					return memoryResult({ action, scope, ...labelled(runtime), changed, entry: text, to });
				}
				const changed = await runtime.forget(scope, text);
				if (!changed) {
					return memoryResult(
						{ action, scope, ...labelled(runtime), changed: false, entry: text },
						`No ${scopeLabel(scope)} memory note matches: ${text}`,
					);
				}
				return memoryResult({ action, scope, ...labelled(runtime), changed, entry: text });
			} catch (error) {
				return memoryResult({ action, scope, ...labelled(runtime), changed: false }, messageOf(error));
			}
		},

		renderCall(args, theme, context) {
			const body = formatCallText(
				args as { action?: unknown; text?: unknown; to?: unknown; scope?: unknown },
				context.argsComplete,
			);
			return callLine(theme, context.lastComponent, TOOL_NAME, body);
		},

		renderResult(result, { expanded }, theme, context) {
			const text = reuseText(context.lastComponent);
			const outcome = detailsOrLine(theme, result, expanded, toolDetails<MemoryDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			text.setText(formatResultText(outcome.details, expanded));
			return text;
		},
	});
}
