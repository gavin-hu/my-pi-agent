/**
 * The shared shape of a tool result.
 *
 * Every extension tool returns the same envelope: one text block the model
 * reads, the extension's own `details` for the renderer and the session branch,
 * and — where the tool declares an `outputSchema` — the JSON mirror Pi calls
 * `structuredContent`. A rejected call is that envelope marked `isError`, still
 * carrying the previous state so the model can retry.
 *
 * `textResult` and `failedResult` build the two, so the flag and the absent
 * `structuredContent` are decided once. What stays with the extension is the
 * text and the mirror: `structuredContent` drops `undefined` field by field and
 * projects nested objects, so it is written per `details` type rather than
 * derived. `toolError` / `errorResult` keep the shorthand the
 * action-and-message tools (`job` and `watch`) share.
 *
 * The other half of the same contract is reading a result back off the session
 * branch, which is how one extension reads another's state: `toolResultDetails`
 * is the one scan that decides an entry is a successful tool result for a given
 * tool — not another entry, another tool's result, or a rejected call, which
 * carries the unchanged state beside an `error`, and not a `details` a tampered
 * branch left as something other than a record. [`goal-state.ts`](./goal-state.ts)
 * and [`todo-state.ts`](./todo-state.ts) replay through it and keep only the value
 * they validate, so neither can grow an arm the other lacks.
 */

import type { JsonValue } from "@earendil-works/pi-ai";

/** Minimal shape of a session entry, used for runtime narrowing. */
export interface BranchEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolName?: string;
		details?: unknown;
	};
}

/**
 * The `details` of the branch entry when it is a successful tool result for
 * `toolName`, or `undefined` for anything else: another entry, another tool's
 * result, a rejected call, or `details` that is not a record — a tampered entry
 * is skipped, never thrown on.
 */
export function toolResultDetails(entry: unknown, toolName: string): Record<string, unknown> | undefined {
	const branchEntry = entry as BranchEntryLike;
	if (branchEntry?.type !== "message") return undefined;
	const message = branchEntry.message;
	if (message?.role !== "toolResult" || message.toolName !== toolName) return undefined;
	const details = message.details;
	if (!details || typeof details !== "object") return undefined;
	const record = details as Record<string, unknown>;
	return record.error ? undefined : record;
}

/** One text block in a tool result. */
export interface ToolErrorContent {
	type: "text";
	text: string;
}

/** A tool result: what the model reads, the extension's details, and its JSON mirror. */
export interface ToolResult<Details> {
	content: ToolErrorContent[];
	details: Details;
	structuredContent?: Record<string, JsonValue>;
}

/** A rejected call: the result, marked so the host reports it as an error. */
export interface ToolFailure<Details> extends ToolResult<Details> {
	isError: true;
}

/** The content and details both results share. */
function envelope<Details>(text: string, details: Details): ToolResult<Details> {
	return { content: [{ type: "text", text }], details };
}

/** A successful call. */
export function textResult<Details>(
	text: string,
	details: Details,
	structuredContent?: Record<string, JsonValue>,
): ToolResult<Details> {
	const result = envelope(text, details);
	return structuredContent === undefined ? result : { ...result, structuredContent };
}

/** A rejected call, keeping the state the caller had before it. */
export function failedResult<Details>(
	text: string,
	details: Details,
	structuredContent?: Record<string, JsonValue>,
): ToolFailure<Details> {
	const result = envelope(text, details);
	return structuredContent === undefined
		? { ...result, isError: true }
		: { ...result, structuredContent, isError: true };
}

/** A rejected tool call: the message as content, the extension's details, and the error flag. */
export function toolError<Details extends { action: string; error: string }>(
	message: string,
	details: Details,
): { content: ToolErrorContent[]; details: Details; isError: true } {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details,
		isError: true,
	};
}

/** A rejected tool call whose details are only the action and the message. */
export function errorResult<Action extends string>(
	action: Action,
	message: string,
): { content: ToolErrorContent[]; details: { action: Action; error: string }; isError: true } {
	return toolError(message, { action, error: message });
}
