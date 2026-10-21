/**
 * Reading a nested `ctx.executeTool` result.
 *
 * The plan tools delegate to `todo` and `goal` so their validation and widgets
 * run normally; when the nested call fails, its first text line is the reason
 * worth reporting, sanitized because a tool message is untrusted text.
 */

import { sanitizeLine } from "../../../lib/format.ts";

/** The shape of a nested tool outcome the plan tools read. */
interface NestedOutcome {
	result?: { content?: ReadonlyArray<{ type: string; text?: string }> };
}

/** The first text line of a nested result, sanitized, or undefined. */
export function firstTextLine(outcome: NestedOutcome): string | undefined {
	const part = outcome.result?.content?.find((entry) => entry.type === "text");
	const text = part?.type === "text" && typeof part.text === "string" ? part.text.split("\n", 1)[0] : undefined;
	return text ? sanitizeLine(text) : undefined;
}
