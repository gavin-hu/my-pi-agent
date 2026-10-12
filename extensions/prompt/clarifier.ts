/**
 * Prompt text for the refine flow: the clarifier's system prompt, the recent
 * conversation block, the request it receives, and the prompt assembled from
 * the answers.
 *
 * All pure: no host access and no model call. The system prompt is sent only on
 * the nested clarifier call, so it is not part of Pi's always-on prompt budget.
 */

import type { UserMessage } from "@earendil-works/pi-ai";
import { sanitizeLine } from "../../lib/format.ts";
import type { Answer } from "./schema.ts";

/** Longest recent-conversation block sent to the clarifier, in characters. */
export const HISTORY_CHAR_LIMIT = 2000;

/** The clarifier's system prompt, with the question budget filled in. */
export function clarifySystemPrompt(maxQuestions: number): string {
	return `You clarify a user's request before an autonomous coding agent acts on it.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "clear": boolean,
  "goal": "one sentence stating the concrete goal you believe the user wants",
  "questions": [
    {
      "header": "short label, at most 12 characters",
      "question": "the question to ask the user",
      "options": [{ "label": "an answer", "description": "optional clarification" }]
    }
  ]
}

Rules:
- Set "clear" to true when the request is specific enough for the agent to act on, and return an empty "questions" array.
- Otherwise set "clear" to false and ask at most ${maxQuestions} questions whose answers would change what the agent does.
- Ask only what you cannot infer from the request or the recent conversation; never ask the user to restate what they already wrote.
- Give a question 2-4 concrete options when the answers are a small known set, or no options at all when the answer is free-form.
- Keep "goal" to one sentence and omit implementation steps.`;
}

/** The text parts of a message content value, joined. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const record = part as { type?: unknown; text?: unknown };
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
	}
	return parts.join("\n");
}

/** The shape `recentTurnText` reads from a session branch entry. */
interface BranchEntryLike {
	type?: string;
	message?: { role?: string; content?: unknown };
}

/**
 * A compact plain-text rendering of the last `limit` user/assistant turns.
 *
 * Rendered as text rather than synthetic message objects so the clarifier
 * request stays a single well-formed user message, and so no tool-call pairing
 * has to be preserved. Returns `""` when `limit` is 0 or there is nothing to
 * show; the tail is kept when the block exceeds {@link HISTORY_CHAR_LIMIT}.
 */
export function recentTurnText(branch: readonly BranchEntryLike[], limit: number): string {
	if (limit <= 0) return "";
	const blocks: string[] = [];
	for (let i = branch.length - 1; i >= 0 && blocks.length < limit; i--) {
		const entry = branch[i];
		if (entry?.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = sanitizeLine(textOf(entry.message?.content));
		if (!text) continue;
		blocks.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}
	const joined = blocks.reverse().join("\n");
	return joined.length > HISTORY_CHAR_LIMIT ? joined.slice(-HISTORY_CHAR_LIMIT) : joined;
}

/** The clarifier's user message: the request, prefixed by recent context. */
export function buildClarifyUserText(prompt: string, history: string): string {
	const trimmed = history.trim();
	return trimmed ? `Recent conversation:\n${trimmed}\n\nRequest: ${prompt}` : prompt;
}

/** The request sent to the clarifier. */
export function buildClarifyMessages(
	systemPrompt: string,
	userText: string,
	now = Date.now(),
): { systemPrompt: string; messages: UserMessage[] } {
	return {
		systemPrompt,
		messages: [{ role: "user", content: [{ type: "text", text: userText }], timestamp: now }],
	};
}

/**
 * The submitted prompt: the original wording, then the confirmed goal and the
 * answered questions. `goal` and `answers` are already sanitized.
 */
export function buildRefinedPrompt(original: string, goal: string, answers: readonly Answer[]): string {
	const parts = [original.trim()];
	const tail: string[] = [];
	if (goal) tail.push(`Clarified goal: ${goal}`);
	if (answers.length > 0) {
		if (tail.length > 0) tail.push("");
		tail.push("Clarifications:");
		for (const answer of answers) {
			tail.push(`- ${answer.header}: ${answer.question}`, `  Answer: ${answer.answer}`);
		}
	}
	if (tail.length > 0) parts.push("", ...tail);
	return parts.join("\n");
}
