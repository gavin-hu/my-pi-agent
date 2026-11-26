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
 * actions read comes from `board/actions.ts`, so this module stays value-only.
 */

import type { ExtensionAPI, ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { isBoardReadAction, isBoardWorkAction } from "./workflow/actions.ts";
import { READ_DOC_TOOL, SUBAGENT_READ_ONLY_PARAM, SUBAGENT_TOOL } from "./tool-names.ts";

/**
 * Whether a call to the `board` tool only reads it.
 *
 * The board is one tool over many actions, so its `readOnlyHint` says "may write" and
 * cannot answer this. The action can, and it travels in the call's input — and in the
 * result's `details`, which is all a `tool_execution_end` event carries. Plan mode
 * asks before the call and the todo nudge after it, so the answer lives here once —
 * and the answer is the board's own table, because an action list kept here is a list
 * that drifts.
 */
export function isBoardRead(call: unknown): boolean {
	if (typeof call !== "object" || call === null) return false;
	return isBoardReadAction((call as { action?: unknown }).action);
}

/**
 * Whether the registered `subagent` tool declares the read-only parameter a mode
 * pins. A mode that only reads must not start a writing child, and a `subagent`
 * that cannot honour the flag is refused rather than run read-write — which is why
 * the probe, the pin, and the parameter name agree here, beside the classification
 * both modes already share, instead of in the extension that happened to need it
 * first. Two callers: plan mode pins every call while planning, and the board's
 * write gate pins one while the session holds no card in `execute`.
 */
export function supportsReadOnlyDelegation(pi: Pick<ExtensionAPI, "getAllTools">): boolean {
	const info = pi.getAllTools().find((tool) => tool.name === SUBAGENT_TOOL);
	const properties = (info?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
	return properties !== undefined && Object.prototype.hasOwnProperty.call(properties, SUBAGENT_READ_ONLY_PARAM);
}

/**
 * Pin a `subagent` call to read-only delegation, or say why it cannot be pinned.
 *
 * The pair plan mode used to hold alone — probe the tool, refuse when it cannot honour the
 * parameter, then set the parameter in place so the model cannot forget it — is one body, because
 * the board's write gate pins the same flag while the session holds no card in `execute`. The
 * sentence comes back bare: the caller prefixes its own mode and appends its own guidance.
 *
 * `undefined` is the ordinary answer, and the call now runs read-only.
 */
export function pinReadOnlySubagent(pi: Pick<ExtensionAPI, "getAllTools">, input: unknown): string | undefined {
	if (!supportsReadOnlyDelegation(pi)) {
		return `the registered "${SUBAGENT_TOOL}" tool does not support read-only delegation; explore with the structured tools instead.`;
	}
	if (typeof input === "object" && input !== null) {
		(input as Record<string, unknown>)[SUBAGENT_READ_ONLY_PARAM] = true;
	}
	return undefined;
}

/**
 * Whether a call to the `board` tool can have changed a working tree.
 *
 * Not the complement of {@link isBoardRead}: plan mode must admit a `list` and refuse a card
 * write, while the todo nudge needs to know whether a call did work — and a card write did
 * none, because the board lives in the agent directory. `review` is the one action on the other
 * side, a write that runs the contract's command in a tree. The answer is the board's own
 * effect table, read from the same place a `tool_execution_end` event carries: the result's
 * `details`.
 */
export function isBoardWork(call: unknown): boolean {
	if (typeof call !== "object" || call === null) return false;
	return isBoardWorkAction((call as { action?: unknown }).action);
}

/**
 * Whether a `subagent` call can have changed a working tree.
 *
 * The child's mode is the answer, and the tool publishes it: `makeDetails`
 * (`extensions/subagent/index.ts`) puts `readOnly: args.readOnly === true` into every result
 * it builds — a dispatched run, a refused call, and the background start, which spreads that
 * object. A `tool_execution_end` event carries no input, but it carries this, so the hint —
 * `readOnlyHint: false`, because a writing child may do anything — never has to be guessed at.
 *
 * One answer serves two questions: a read-only child is investigation, the same as `rg`, while a
 * writing child may have changed any file, so it is work and a file write together.
 *
 * The caller gates on the tool's name before asking, and that gate is load-bearing: the field is
 * read off whatever details it is handed, so another tool that happens to publish `readOnly`
 * would otherwise answer for this one. A missing field is not work, the bias the nudge states —
 * a false positive costs a model request, a missed reminder costs nothing.
 */
export function isSubagentWork(call: unknown): boolean {
	if (typeof call !== "object" || call === null) return false;
	return (call as { readOnly?: unknown }).readOnly === false;
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
