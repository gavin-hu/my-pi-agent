/**
 * Cross-extension contracts.
 *
 * An extension never imports another extension's modules (see `test/README.md`),
 * so a contract between two extension surfaces is guarded here, at the package
 * level, rather than beside either module.
 */

import { describe, expect, test } from "bun:test";
import { normalizeQuestions as askNormalize } from "../extensions/ask-user-question/schema.ts";
import { parseClarification } from "../extensions/goal/clarify-parse.ts";
import { clarifyReply, SCOPE_QUESTION } from "./helpers/fixtures/goal.ts";

describe("goal clarification to ask_user_question", () => {
	// The questions `goal` proposes are passed verbatim to the tool the agent
	// calls with them, so ask_user_question's validator must accept every set.
	const replies = [
		clarifyReply(),
		clarifyReply({ questions: [SCOPE_QUESTION, SCOPE_QUESTION] }),
		clarifyReply({
			questions: [
				{ header: "Q2", question: "First?", options: [{ label: "A" }, { label: "B" }] },
				{ header: "Q2", question: "Second?", options: [{ label: "A" }, { label: "B" }] },
			],
		}),
		clarifyReply({
			questions: Array.from({ length: 5 }, (_, i) => ({
				header: `H${i}`,
				question: `Q${i}?`,
				options: [{ label: "a" }, { label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }],
			})),
		}),
		clarifyReply({ questions: [{ header: "Free", question: "Anything to add?", options: [] }] }),
	];

	test("every normalized question set is accepted by ask_user_question", () => {
		for (const reply of replies) {
			const clarification = parseClarification(reply);
			expect(clarification).toBeDefined();
			if (!clarification || clarification.clear) continue;
			expect(() => askNormalize(clarification.questions)).not.toThrow();
		}
	});
});
