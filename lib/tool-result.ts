/**
 * The shared shape of a rejected tool call.
 *
 * Extension tools return an `isError: true` result carrying their own `details`
 * type. `toolError` builds the content and the flag so the extensions that
 * reject a call (`job` and `watch`, plus any future tool) agree on the shape.
 */

/** One text block in a tool result. */
export interface ToolErrorContent {
	type: "text";
	text: string;
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
