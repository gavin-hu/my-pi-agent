/**
 * Read-only capability policy shared by extensions that classify tool calls:
 * plan mode blocks everything not provably read-only, and rewind uses the same
 * classification to decide which calls are worth a snapshot.
 *
 * Instead of enumerating the tools that mutate, this defaults to *deny*: a tool
 * call is allowed only when the tool is a known structured reader or carries the
 * MCP `readOnlyHint`. That makes the policy correct for tools it has never seen
 * — `bash`, MCP servers, future extension tools — rather than relying on
 * `write`/`edit` being the only mutators.
 *
 * No host dependency beyond the annotation type: the caller supplies the
 * annotation lookup, the one reader name comes from `tool-names.ts`, and which board
 * verbs read comes from `board/verbs.ts`, so this module stays value-only.
 */

import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { isBoardReadAction } from "./board/verbs.ts";
import { READ_DOC_TOOL } from "./tool-names.ts";

/**
 * Whether a call to the `board` tool only reads it.
 *
 * The board is one tool over many actions, so its `readOnlyHint` says "may write" and
 * cannot answer this. The action can, and it travels in the call's input — and in the
 * result's `details`, which is all a `tool_execution_end` event carries. Plan mode
 * asks before the call and the todo nudge after it, so the answer lives here once —
 * and the answer is the board's own table, because a verb list kept here is a list
 * that drifts.
 */
export function isBoardRead(call: unknown): boolean {
	if (typeof call !== "object" || call === null) return false;
	return isBoardReadAction((call as { action?: unknown }).action);
}

/**
 * Tools that only read the workspace: the built-in structured readers and the
 * packaged document reader. One list for the read-only consumers — plan mode's
 * allowlist, rewind's snapshot policy, and subagent's read-only child allowlist —
 * so adding a reader is one edit rather than three.
 */
export const WORKSPACE_READERS = ["read", "grep", "find", "ls", READ_DOC_TOOL] as const;

interface ReadOnlyPolicyOptions {
	/** Tools allowed regardless of annotations (structured readers, plan tracker). */
	allow?: Iterable<string>;
	/** Tools blocked even when annotated read-only. */
	deny?: Iterable<string>;
	/** Resolve a tool's MCP annotations, for tools not named in `allow`/`deny`. */
	annotations?: (toolName: string) => ToolAnnotations | undefined;
	/** Appended to a block reason to tell the model how to proceed. */
	guidance?: string;
}

/** How a tool would be treated in a read-only session. */
type ToolKind = "read-only" | "mutating";

interface BlockedCall {
	block: true;
	reason: string;
}

export interface ReadOnlyPolicy {
	/** Classify a tool by name. */
	classify(toolName: string): ToolKind;
	/** Whether the tool may stay active during a read-only session. */
	isAllowed(toolName: string): boolean;
	/** `{ block: true, reason }` when the call must be blocked, else `undefined`. */
	check(toolName: string): BlockedCall | undefined;
}

export function createReadOnlyPolicy(options: ReadOnlyPolicyOptions = {}): ReadOnlyPolicy {
	const allow = new Set(options.allow ?? []);
	const deny = new Set(options.deny ?? []);
	const annotations = options.annotations ?? (() => undefined);
	const guidance = options.guidance ? ` ${options.guidance}` : "";

	const classify = (toolName: string): ToolKind => {
		if (deny.has(toolName)) return "mutating";
		if (allow.has(toolName)) return "read-only";
		if (annotations(toolName)?.readOnlyHint === true) return "read-only";
		return "mutating";
	};

	return {
		classify,
		isAllowed: (toolName) => classify(toolName) !== "mutating",
		check(toolName) {
			if (classify(toolName) === "read-only") return undefined;
			return { block: true, reason: `"${toolName}" is not read-only.${guidance}` };
		},
	};
}
