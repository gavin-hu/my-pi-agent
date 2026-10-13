/**
 * Prompt text and reply parsing for the goal refine step.
 *
 * All pure: no host access and no model call. The system prompt is sent only on
 * the nested clarifier call, so it is not part of Pi's always-on prompt budget.
 * Parsing is the boundary for the model's reply: it strips the decoration a
 * model likes to add and routes the result through `sanitizeLine`, so nothing
 * untrusted reaches the editor, the widget, or the transcript.
 */

import type { UserMessage } from "@earendil-works/pi-ai";
import { sanitizeLine } from "../../lib/format.ts";
import { MAX_OBJECTIVE } from "./schema.ts";

/** The clarifier's system prompt. */
export const REFINE_SYSTEM_PROMPT = `You rewrite a user's session goal before it is recorded.

Reply with ONLY the rewritten goal as one line of plain text: no prose, no
preamble, no quotes, and no code fence.

Rules:
- Keep the user's intent exactly. Do not add requirements, tools, files, or scope
  the user did not state.
- Make the goal specific and actionable when the request already implies the
  detail; otherwise keep it general.
- Keep it to one sentence. Do not list steps.`;

/** The user message sent to the clarifier alongside {@link REFINE_SYSTEM_PROMPT}. */
export function buildRefineUserText(text: string): string {
	return `Rewrite this session goal:\n\n${text}`;
}

/** The request sent to the clarifier. */
export function buildRefineMessages(text: string, now = Date.now()): { systemPrompt: string; messages: UserMessage[] } {
	return {
		systemPrompt: REFINE_SYSTEM_PROMPT,
		messages: [{ role: "user", content: [{ type: "text", text: buildRefineUserText(text) }], timestamp: now }],
	};
}

/** Quote characters a model may wrap its reply in. */
const WRAPPING_QUOTES = /^["'`\u2018\u2019\u201c\u201d]+|["'`\u2018\u2019\u201c\u201d]+$/g;

/** A leading `Goal:` / `Objective -` label, which the goal itself does not need. */
const LEADING_LABEL = /^(?:goal|objective)\s*[:\-]\s*/i;

/** Remove one layer of wrapping quotes/labels from an already-trimmed reply. */
function stripDecoration(text: string): string {
	return text.replace(WRAPPING_QUOTES, "").trim().replace(LEADING_LABEL, "").replace(WRAPPING_QUOTES, "").trim();
}

/**
 * Turn the clarifier's raw reply into a goal objective, or `undefined` when it
 * is unusable.
 *
 * A fenced block is unwrapped, a leading label and wrapping quotes are dropped,
 * and the result is sanitized to one line. An empty result, or one over
 * {@link MAX_OBJECTIVE}, returns `undefined` so the caller falls back to the
 * text the user typed.
 */
export function parseRefinedGoal(raw: string | undefined): string | undefined {
	if (typeof raw !== "string") return undefined;
	const fenced = /```[^\n]*\n?([\s\S]*?)```/.exec(raw);
	const withoutFence = fenced ? fenced[1] : raw;
	const objective = sanitizeLine(stripDecoration(withoutFence));
	if (!objective || objective.length > MAX_OBJECTIVE) return undefined;
	return objective;
}
