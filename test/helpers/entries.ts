/**
 * Shared session-entry fixtures.
 *
 * A tool-result entry is how an extension stores state on the session branch;
 * `userMessage` stands in for an unrelated conversation message. Both are used
 * across extensions so the shapes are defined once.
 */

/** ISO timestamp for an epoch-ms value, without reading the wall clock. */
export function isoTime(ms: number): string {
	return new Date(ms).toISOString();
}

/** A stored tool-result entry, as it appears on a session branch. */
export function toolResultEntry(toolName: string, details: unknown): unknown {
	return { type: "message", message: { role: "toolResult", toolName, details } };
}

/** The content of the last widget set on a context, or undefined. */
export function lastWidget(calls: Array<{ key: string; content: unknown }>): unknown {
	return calls.at(-1)?.content;
}

/** An unrelated user message. */
export function userMessage(text = "just a normal message"): unknown {
	return { role: "user", content: text };
}

/** An unrelated user message (legacy name). */
export const otherMessage = userMessage;
