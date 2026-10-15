import { describe, expect, test } from "bun:test";
import {
	MAX_STEPS,
	MAX_STEP_LENGTH,
	PLAN_OUTLINE,
	PLAN_SECTIONS,
	extractPlanSections,
	extractPlanSteps,
	setStepStatuses,
} from "./steps.ts";

const pending = (content: string) => ({ content, status: "pending" as const });
const completed = (content: string) => ({ content, status: "completed" as const });

describe("extractPlanSteps", () => {
	test("reads a numbered plan", () => {
		const plan = ["Plan:", "1. Read the parser", "2. Add a tokenizer", "3. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			pending("Read the parser"),
			pending("Add a tokenizer"),
			pending("Update tests"),
		]);
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
		expect(extractPlanSteps(plan)).toEqual([pending("First task"), completed("Done task"), completed("Also done")]);
	});

	test("skips nested sub-bullets", () => {
		const plan = ["1. Add the lexer", "   - nested note", "   - another note", "2. Update tests"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the lexer"), pending("Update tests")]);
	});

	test("keeps a uniformly indented plan", () => {
		const plan = ["  - One", "  - Two"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("One"), pending("Two")]);
	});

	test("ignores list items inside fenced code blocks", () => {
		const plan = [
			"Plan:",
			"```yaml",
			"- name: foo",
			"  1. nested example",
			"```",
			"1. Real step one",
			"2. Real step two",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Real step one"), pending("Real step two")]);
	});

	test("ignores list items inside tilde fences", () => {
		const plan = ["~~~", "- not a step", "~~~", "- Real step"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Real step")]);
	});

	test("treats an unclosed fence as hiding the rest", () => {
		const plan = ["1. Before fence", "```", "- inside"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Before fence")]);
	});

	test("uses the shallowest list as the top level regardless of order", () => {
		const plan = ["  - nested first", "- top level", "  - another nested", "- second top"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("top level"), pending("second top")]);
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

describe("PLAN_OUTLINE", () => {
	test("documents every section and a checkbox step", () => {
		for (const title of PLAN_SECTIONS) expect(PLAN_OUTLINE).toContain(`## ${title}`);
		expect(PLAN_OUTLINE).toContain("- [ ] ");
	});
});

describe("extractPlanSections", () => {
	test("splits a canonical plan at its headings", () => {
		const plan = ["# Title", "", "## Goal", "Ship it.", "", "## Steps", "- [ ] One"].join("\n");
		expect(extractPlanSections(plan).map((s) => s.title)).toEqual(["Title", "Goal", "Steps"]);
		expect(extractPlanSections(plan)[1].text.split("\n")[0]).toBe("## Goal");
		expect(extractPlanSections(plan)[1].text).toContain("Ship it.");
	});

	test("keeps content before the first heading as an untitled section", () => {
		const plan = ["intro line", "", "## Goal", "x"].join("\n");
		const sections = extractPlanSections(plan);
		expect(sections[0].title).toBe("");
		expect(sections[0].text).toContain("intro line");
	});

	test("drops a blank preamble and strips inline formatting from titles", () => {
		expect(extractPlanSections("\n\n## **Goal** `x`")[0].title).toBe("Goal x");
	});

	test("ignores `#` lines inside code fences", () => {
		const plan = ["## Real", "```sh", "# not a heading", "```", "## Also real"].join("\n");
		expect(extractPlanSections(plan).map((s) => s.title)).toEqual(["Real", "Also real"]);
	});

	test("returns nothing for an empty plan", () => {
		expect(extractPlanSections("")).toEqual([]);
		expect(extractPlanSections("\n\n")).toEqual([]);
	});
});

describe("setStepStatuses", () => {
	test("marks a numbered step done and leaves its text alone", () => {
		const plan = ["1. Read the parser", "2. Add a tokenizer"].join("\n");
		const result = setStepStatuses(plan, [{ step: 2, status: "completed" }]);
		expect(result).toBe("1. Read the parser\n2. [x] Add a tokenizer");
	});

	test("adds a checkbox to a plain list item", () => {
		expect(setStepStatuses("- Do the thing", [{ step: 1, status: "completed" }])).toBe("- [x] Do the thing");
	});

	test("returns to pending", () => {
		expect(setStepStatuses("- [x] Done", [{ step: 1, status: "pending" }])).toBe("- [ ] Done");
	});

	test("applies several steps in one pass", () => {
		const plan = ["1. One", "2. Two", "3. Three"].join("\n");
		const result = setStepStatuses(plan, [
			{ step: 1, status: "completed" },
			{ step: 3, status: "completed" },
		]);
		expect(result).toBe("1. [x] One\n2. Two\n3. [x] Three");
	});

	test("reopening drops a DONE marker so the file agrees with the status", () => {
		const result = setStepStatuses("- First [DONE:1]\n- Second", [{ step: 1, status: "pending" }]);
		expect(result).toBe("- [ ] First\n- Second");
		expect(extractPlanSteps(result as string)).toEqual([pending("First"), pending("Second")]);
	});

	test("keeps a DONE marker when the step stays completed", () => {
		const result = setStepStatuses("- First [DONE:1]", [{ step: 1, status: "completed" }]);
		expect(result).toBe("- [x] First [DONE:1]");
	});

	test("a duplicate step takes the last entry", () => {
		const result = setStepStatuses("- One", [
			{ step: 1, status: "completed" },
			{ step: 1, status: "pending" },
		]);
		expect(result).toBe("- [ ] One");
	});

	test("aligns its numbering with extractPlanSteps", () => {
		const plan = ["1. Same", "2. same", "3. Other"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Same"), pending("Other")]);
		const result = setStepStatuses(plan, [{ step: 2, status: "completed" }]);
		expect(result).toBe("1. Same\n2. same\n3. [x] Other");
	});

	test("ignores steps inside fences", () => {
		const plan = ["```", "- nope", "```", "- Real"].join("\n");
		const result = setStepStatuses(plan, [{ step: 1, status: "completed" }]);
		expect(result).toContain("- [x] Real");
		expect(result).toContain("- nope");
	});

	test("changes nothing when any step is out of range or non-integer", () => {
		expect(setStepStatuses("- One", [{ step: 0, status: "completed" }])).toBeUndefined();
		expect(setStepStatuses("- One", [{ step: 2, status: "completed" }])).toBeUndefined();
		expect(setStepStatuses("- One", [{ step: 1.5, status: "completed" }])).toBeUndefined();
		expect(
			setStepStatuses("- One\n- Two", [
				{ step: 1, status: "completed" },
				{ step: 9, status: "completed" },
			]),
		).toBeUndefined();
	});
});
