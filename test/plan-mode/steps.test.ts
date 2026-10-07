import { describe, expect, test } from "bun:test";
import { MAX_STEPS, MAX_STEP_LENGTH, extractPlanSteps } from "../../extensions/plan-mode/steps.ts";

describe("extractPlanSteps", () => {
	test("reads a numbered plan", () => {
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual(["Read the parser", "Add a tokenizer", "Update tests"]);
	});

	test("reads `1)` numbering and bullet lists", () => {
		expect(extractPlanSteps("1) First\n2) Second")).toEqual(["First", "Second"]);
		expect(extractPlanSteps("- Alpha\n* Beta\n+ Gamma")).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	test("strips emphasis, code, and done markers", () => {
		const plan = "1. **Bold** step with `code` [DONE:1]\n2. _Italic_ one";
		expect(extractPlanSteps(plan)).toEqual(["Bold step with code", "Italic one"]);
	});

	test("skips prose and blank lines", () => {
		const plan = ["Here is the plan.", "", "1. Only real step", "Done."].join("\n");
		expect(extractPlanSteps(plan)).toEqual(["Only real step"]);
	});

	test("de-duplicates steps", () => {
		expect(extractPlanSteps("1. Same\n2. same\n3. Other")).toEqual(["Same", "Other"]);
	});

	test("elides very long steps", () => {
		const [step] = extractPlanSteps(`1. ${"x".repeat(MAX_STEP_LENGTH + 50)}`);
		expect(step.length).toBe(MAX_STEP_LENGTH);
		expect(step.endsWith("…")).toBe(true);
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
