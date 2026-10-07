import { describe, expect, test } from "bun:test";
import { MAX_STEPS, MAX_STEP_LENGTH, extractPlanSteps } from "../../extensions/plan-mode/steps.ts";

const pending = (content: string) => ({ content, status: "pending" as const });
const completed = (content: string) => ({ content, status: "completed" as const });

describe("extractPlanSteps", () => {
	test("reads a numbered plan", () => {
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Read the parser"), pending("Add a tokenizer"), pending("Update tests")]);
	});

	test("reads `1)` numbering and bullet lists", () => {
		expect(extractPlanSteps("1) First\n2) Second")).toEqual([pending("First"), pending("Second")]);
		expect(extractPlanSteps("- Alpha\n* Beta\n+ Gamma")).toEqual([pending("Alpha"), pending("Beta"), pending("Gamma")]);
	});

	test("strips emphasis, code, and done markers", () => {
		const plan = "1. **Bold** step with `code` [DONE:1]\n2. _Italic_ one";
		expect(extractPlanSteps(plan)).toEqual([completed("Bold step with code"), pending("Italic one")]);
	});

	test("keeps underscores inside identifiers", () => {
		const plan = "1. Rename user_id to account_id\n2. Read snake_case_file.ts";
		expect(extractPlanSteps(plan)).toEqual([
			pending("Rename user_id to account_id"),
			pending("Read snake_case_file.ts"),
		]);
	});

	test("turns checkboxes into status", () => {
		const plan = ["- [ ] First task", "- [x] Done task", "- [X] Also done"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			pending("First task"),
			completed("Done task"),
			completed("Also done"),
		]);
	});

	test("skips nested sub-bullets", () => {
		const plan = ["1. Add the lexer", "   - nested note", "   - another note", "2. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the lexer"), pending("Update tests")]);
	});

	test("keeps a uniformly indented plan", () => {
		const plan = ["  - One", "  - Two"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("One"), pending("Two")]);
	});

	test("skips prose and blank lines", () => {
		const plan = ["Here is the plan.", "", "1. Only real step", "Done."].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Only real step")]);
	});

	test("de-duplicates steps", () => {
		expect(extractPlanSteps("1. Same\n2. same\n3. Other")).toEqual([pending("Same"), pending("Other")]);
	});

	test("elides very long steps", () => {
		const [step] = extractPlanSteps(`1. ${"x".repeat(MAX_STEP_LENGTH + 50)}`);
		expect(step.content.length).toBe(MAX_STEP_LENGTH);
		expect(step.content.endsWith("…")).toBe(true);
	});

	test("caps the number of steps", () => {
		const plan = Array.from({ length: MAX_STEPS + 10 }, (_, i) => `${i + 1}. step ${i}`).join("\n");
		expect(extractPlanSteps(plan)).toHaveLength(MAX_STEPS);
	});

	test("returns nothing for a plan without steps", () => {
		expect(extractPlanSteps("Just some prose.")).toEqual([]);
		expect(extractPlanSteps("")).toEqual([]);
	});
});
