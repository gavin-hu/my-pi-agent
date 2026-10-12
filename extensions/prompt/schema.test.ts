import { describe, expect, test } from "bun:test";
import { GOAL_MAX_CHARS, HEADER_MAX_WIDTH, MAX_OPTIONS, parseClarification } from "./schema.ts";

const reply = (value: unknown): string => JSON.stringify(value);

describe("parseClarification", () => {
	test("returns undefined when there is no JSON object", () => {
		expect(parseClarification("no json here", 3)).toBeUndefined();
		expect(parseClarification("[1,2,3]", 3)).toBeUndefined();
		expect(parseClarification("{ not json }", 3)).toBeUndefined();
	});

	test("parses a fenced JSON reply", () => {
		const parsed = parseClarification(
			`Here you go:\n\`\`\`json\n${reply({ clear: false, goal: "Ship the parser", questions: [] })}\n\`\`\``,
			3,
		);
		expect(parsed).toEqual({ clear: false, goal: "Ship the parser", questions: [] });
	});

	test("drops questions when the request is already clear", () => {
		const parsed = parseClarification(
			reply({ clear: true, goal: "Run the tests", questions: [{ question: "Which tests?" }] }),
			3,
		);
		expect(parsed).toEqual({ clear: true, goal: "Run the tests", questions: [] });
	});

	test("normalizes questions, options, and headers", () => {
		const parsed = parseClarification(
			reply({
				clear: false,
				goal: "Add auth",
				questions: [
					{
						header: "Auth method",
						question: "  Which auth should we use?  ",
						options: [{ label: "OAuth", description: "  provider flow  " }, { label: "Session cookies" }],
					},
					{ question: "Any deadline?" },
				],
			}),
			3,
		);
		expect(parsed?.questions).toEqual([
			{
				header: "Auth method",
				question: "Which auth should we use?",
				options: [{ label: "OAuth", description: "provider flow" }, { label: "Session cookies" }],
			},
			{ header: "Q2", question: "Any deadline?", options: [] },
		]);
	});

	test("drops questions without usable text", () => {
		const parsed = parseClarification(
			reply({ clear: false, goal: "", questions: [{ question: "   " }, { question: "Real?" }] }),
			3,
		);
		expect(parsed?.questions.map((question) => question.question)).toEqual(["Real?"]);
	});

	test("clamps the header and the goal", () => {
		const parsed = parseClarification(reply({ clear: false, goal: "g".repeat(GOAL_MAX_CHARS + 50), questions: [] }), 3);
		expect(parsed?.goal).toHaveLength(GOAL_MAX_CHARS);

		const [question] =
			parseClarification(reply({ clear: false, questions: [{ header: "a".repeat(40), question: "Q?" }] }), 3)
				?.questions ?? [];
		expect(question.header).toHaveLength(HEADER_MAX_WIDTH);
	});

	test("treats a single option as free-form and caps options", () => {
		const [single] =
			parseClarification(reply({ clear: false, questions: [{ question: "Q?", options: [{ label: "only" }] }] }), 3)
				?.questions ?? [];
		expect(single.options).toEqual([]);

		const many = Array.from({ length: MAX_OPTIONS + 2 }, (_, i) => ({ label: `o${i}` }));
		const [capped] =
			parseClarification(reply({ clear: false, questions: [{ question: "Q?", options: many }] }), 3)?.questions ?? [];
		expect(capped.options).toHaveLength(MAX_OPTIONS);
	});

	test("drops duplicate options and blank labels", () => {
		const [question] =
			parseClarification(
				reply({
					clear: false,
					questions: [
						{
							question: "Q?",
							options: [{ label: "A" }, { label: "a" }, { label: "  " }, { label: "B" }],
						},
					],
				}),
				3,
			)?.questions ?? [];
		expect(question.options.map((option) => option.label)).toEqual(["A", "B"]);
	});

	test("caps the number of questions at the budget", () => {
		const questions = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}?` }));
		const parsed = parseClarification(reply({ clear: false, questions }), 2);
		expect(parsed?.questions).toHaveLength(2);
		expect(parseClarification(reply({ clear: false, questions }), 0)?.questions).toEqual([]);
	});

	test("sanitizes control characters out of model text", () => {
		const parsed = parseClarification(
			reply({ clear: false, goal: "ship\u001b[31m it", questions: [{ question: "Which\u0007one?" }] }),
			3,
		);
		expect(parsed?.goal).toBe("ship [31m it");
		expect(parsed?.questions[0].question).toBe("Which one?");
	});
});
