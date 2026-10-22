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
 */

import type { JsonValue } from "@earendil-works/pi-ai";

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
