/**
 * Prompt text for the goal comprehension step (pure).
 *
 * Sent only on the nested clarifier call, so it is not part of Pi's always-on
 * prompt budget. The model's job is to understand and restate the user's goal —
 * not to improve it — and, when it cannot yet, to ask only what it needs from
 * the user.
 */

import type { UserMessage } from "@earendil-works/pi-ai";
import { MAX_QUESTIONS } from "./clarify-parse.ts";

/** The comprehension system prompt: understand the goal, ask only what is missing. */
export const CLARIFY_SYSTEM_PROMPT = `You are establishing a shared understanding of the user's goal for this session.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "understood": boolean,
  "goal": "the goal as you understand it, in the user's own terms",
  "questions": [
    {
      "question": "what you need the user to tell you",
      "options": [{ "label": "an answer" }]
    }
  ]
}

Rules:
- Set "understood" to true when you know what the user wants to achieve well enough to act on it.
- "goal" restates the user's intent as one sentence: the outcome they want, not how to build it. Never add requirements, tools, files, or scope they did not state. If they already said it clearly, keep their wording.
- When "understood" is false, ask at most ${MAX_QUESTIONS} questions that resolve the ambiguity in intent — the smallest set whose answers would change what the work does.
- Ask only what only the user can answer: purpose, scope, preference, or priority. Never ask for a fact the work itself would reveal, and never ask the user to restate the goal.
- Give a question 2-4 concrete options when the answers are a small known set, or no options at all when free-form.`;

/** The user message sent to the clarifier alongside {@link CLARIFY_SYSTEM_PROMPT}. */
export function buildClarifyUserText(text: string): string {
	return `Understand this session goal:\n\n${text}`;
}

/** The request sent to the clarifier. */
export function buildClarifyMessages(
	text: string,
	now = Date.now(),
): { systemPrompt: string; messages: UserMessage[] } {
	return {
		systemPrompt: CLARIFY_SYSTEM_PROMPT,
		messages: [{ role: "user", content: [{ type: "text", text: buildClarifyUserText(text) }], timestamp: now }],
	};
}
