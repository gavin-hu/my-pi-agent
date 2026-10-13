/**
 * Prompt text for the goal clarify step (pure).
 *
 * The system prompt is sent only on the nested clarifier call, so it is not part
 * of Pi's always-on prompt budget. The delegation text is a one-off user message
 * to the agent, likewise outside the budget.
 */

import type { UserMessage } from "@earendil-works/pi-ai";
import { ASK_USER_QUESTION_TOOL } from "../../lib/tool-names.ts";
import { MAX_QUESTIONS, type ClarifyQuestion } from "./clarify-parse.ts";

/** The clarifier's system prompt. */
export const CLARIFY_SYSTEM_PROMPT = `You prepare a user's session goal before it is recorded.

Reply with ONLY a JSON object, no prose and no code fence:
{
  "clear": boolean,
  "goal": "one sentence stating the goal the user wants",
  "questions": [
    {
      "header": "short label, at most 12 characters",
      "question": "the question to ask the user",
      "options": [{ "label": "an answer", "description": "optional" }]
    }
  ]
}

Rules:
- Set "clear" to true when the goal is specific enough to act on, and return an empty "questions" array.
- Otherwise set "clear" to false and ask at most ${MAX_QUESTIONS} questions whose answers would change what the work does.
- Ask only what the goal does not already say; never ask the user to restate it.
- Give a question 2-4 concrete options when the answers are a small known set, or no options at all when free-form.
- Keep the user's intent exactly. Do not add requirements, tools, files, or scope the user did not state.
- Keep "goal" to one sentence and omit implementation steps.`;

/** The user message sent to the clarifier alongside {@link CLARIFY_SYSTEM_PROMPT}. */
export function buildClarifyUserText(text: string): string {
	return `Prepare this session goal:\n\n${text}`;
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

/**
 * The question payload the agent passes to the tool.
 *
 * `options` is omitted rather than sent as `[]` for a free-form question, since
 * the tool's parameter schema declares a two-item minimum for the array.
 */
function delegateQuestions(questions: readonly ClarifyQuestion[]) {
	return questions.map((question) =>
		question.options.length > 0
			? { header: question.header, question: question.question, options: question.options }
			: { header: question.header, question: question.question },
	);
}

/**
 * Build the user message that delegates clarification to the agent.
 *
 * The `/goal` command cannot call the `model-only` question tool itself, so
 * when the goal is unclear it hands the proposed questions to the running agent,
 * which asks them and then records the clarified goal with the `goal` tool. When
 * `run` is false (a record-only `/goal set`), the agent is told not to start the
 * work after recording.
 */
export function buildDelegateUserText(
	original: string,
	goal: string,
	questions: readonly ClarifyQuestion[],
	options: { run?: boolean } = {},
): string {
	const lines = ["The session goal the user just asked for is not specific enough to record yet:", "", original];
	if (goal) lines.push("", `A likely goal: ${goal}`);
	lines.push(
		"",
		`Ask the user the questions below before starting. Call the ${ASK_USER_QUESTION_TOOL} tool and pass this as its \`questions\` argument:`,
		"",
		JSON.stringify({ questions: delegateQuestions(questions) }),
		"",
		options.run === false
			? `Then record the clarified objective with the goal tool (status "active"); do not start the work yet.`
			: `Then record the clarified objective with the goal tool (status "active") and begin the work.`,
	);
	return lines.join("\n");
}
