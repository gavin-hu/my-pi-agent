/**
 * The plan file's own step shapes: what counts as a step, how many approval tracks, and
 * the text a checkbox edit is matched against.
 *
 * Pure cases only — the store's `setSteps` and the tools that read these live in
 * `plans.test.ts` and `tools.test.ts` — so a change to what a step *is* is proved here
 * rather than through a file write.
 */

import { describe, expect, test } from "bun:test";
import {
	elideStep,
	extractPlanSteps,
	matchesStepText,
	MAX_STEP_LENGTH,
	MAX_STEPS,
	planStepSummary,
	setStepStatuses,
} from "./steps.ts";

/** A pending step, as the extraction returns it. */
const pending = (content: string) => ({ content, status: "pending" as const });
/** A completed step. */
const completed = (content: string) => ({ content, status: "completed" as const });
describe("step extraction", () => {
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

	test("skips nested sub-bullets but keeps a uniformly indented plan", () => {
		const nested = ["1. Add the lexer", "   - nested note", "   - another note", "2. Update tests"].join("\n");
		expect(extractPlanSteps(nested)).toEqual([pending("Add the lexer"), pending("Update tests")]);
		expect(extractPlanSteps("  - One\n  - Two")).toEqual([pending("One"), pending("Two")]);
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

	test("ignores tilde fences and hides the rest after an unclosed fence", () => {
		expect(extractPlanSteps(["~~~", "- not a step", "~~~", "- Real step"].join("\n"))).toEqual([pending("Real step")]);
		expect(extractPlanSteps(["1. Before fence", "```", "- inside"].join("\n"))).toEqual([pending("Before fence")]);
	});

	test("uses the shallowest list as the top level regardless of order", () => {
		const plan = ["  - nested first", "- top level", "  - another nested", "- second top"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("top level"), pending("second top")]);
	});

	test("skips prose and blank lines, and keeps a repeated step as its own item", () => {
		expect(extractPlanSteps(["Here is the plan.", "", "1. Only real step", "Done."].join("\n"))).toEqual([
			pending("Only real step"),
		]);
		// The plan's numbering is the file's, so a repeat is a second step a reader can tick:
		// one todo item per distinct text is the merge's rule, not extraction's.
		expect(extractPlanSteps("1. Same\n2. same\n3. Other")).toEqual([
			pending("Same"),
			pending("same"),
			pending("Other"),
		]);
	});

	test("joins indented continuation lines to their step", () => {
		const plan = [
			"- [ ] Replace the body of the file, keeping the",
			"  opening notice and the commit rule",
			"- [ ] Read it back and re-check it against the",
			"  checklist",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			pending("Replace the body of the file, keeping the opening notice and the commit rule"),
			pending("Read it back and re-check it against the checklist"),
		]);
	});

	test("ends a step at a nested marker, a blank line, or a shallow line", () => {
		const nested = ["- [ ] Add the lexer", "  handles tokens", "  - nested note", "- [ ] Update tests"].join("\n");
		expect(extractPlanSteps(nested)).toEqual([pending("Add the lexer handles tokens"), pending("Update tests")]);

		const blank = ["- [ ] First step", "  continued", "", "  prose after a blank line", "- [ ] Second"].join("\n");
		expect(extractPlanSteps(blank)).toEqual([pending("First step continued"), pending("Second")]);

		const shallow = ["- [ ] Only real step", "  continued", "Done."].join("\n");
		expect(extractPlanSteps(shallow)).toEqual([pending("Only real step continued")]);
	});

	test("keeps a long step whole, and caps the list at its item count", () => {
		const long = "x".repeat(MAX_STEP_LENGTH + 50);
		const [step] = extractPlanSteps(`1. ${long}`);
		// Extraction is the file's view; shortening belongs to the surfaces that show one line.
		expect(step.content).toBe(long);
		expect(elideStep(long).length).toBe(MAX_STEP_LENGTH);
		expect(elideStep(long).endsWith("…")).toBe(true);

		const plan = Array.from({ length: MAX_STEPS + 10 }, (_, i) => `${i + 1}. step ${i}`).join("\n");
		expect(extractPlanSteps(plan)).toHaveLength(MAX_STEPS);
	});

	test("returns nothing for a plan without steps", () => {
		expect(extractPlanSteps("Just some prose.")).toEqual([]);
		expect(extractPlanSteps("")).toEqual([]);
	});
});

describe("step extraction — the Steps section", () => {
	test("reads only the Steps section when the plan has one", () => {
		const plan = [
			"# Plan",
			"## Context",
			"- the repo is large",
			"- prior art exists",
			"## Approach",
			"- use a cache",
			"## Steps",
			"- [ ] Add the cache",
			"- [ ] Wire it",
			"## Risks",
			"- stale reads",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the cache"), pending("Wire it")]);
	});

	test("keeps nested notes inside the section but not as steps", () => {
		const plan = [
			"## Steps",
			"1. Add the cache",
			"   - a nested note",
			"### Check the cache",
			"2. Wire it",
			"## Risks",
			"- stale reads",
		].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Add the cache"), pending("Wire it")]);
	});

	test("an empty Steps section means no steps", () => {
		expect(extractPlanSteps(["## Steps", "", "## Risks", "- stale reads"].join("\n"))).toEqual([]);
	});

	test("ignores a Steps heading inside a fence", () => {
		const plan = ["```md", "## Steps", "- not a step", "```", "- Real step"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Real step")]);
	});

	test("falls back to the whole plan without a Steps heading", () => {
		const plan = ["## Goal", "- first", "## Approach", "- second"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("first"), pending("second")]);
	});

	test("matches the heading case-insensitively and through emphasis", () => {
		const plan = ["## **STEPS**", "- One", "## Risks", "- two"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("One")]);
	});

	test("setStepStatuses edits the section-scoped steps", () => {
		const plan = ["## Context", "- prose", "## Steps", "- [ ] One", "- [ ] Two"].join("\n");
		expect(setStepStatuses(plan, [{ step: 1, status: "completed" }])).toBe(
			["## Context", "- prose", "## Steps", "- [x] One", "- [ ] Two"].join("\n"),
		);
	});
});

describe("step summary and text match", () => {
	test("counts past the cap and counts steps whose text will be shortened", () => {
		const plan = Array.from({ length: MAX_STEPS + 3 }, (_, index) => `${index + 1}. step ${index}`).join("\n");
		expect(planStepSummary(plan)).toEqual({ total: MAX_STEPS + 3, elided: 0 });
		expect(planStepSummary(`1. ${"x".repeat(MAX_STEP_LENGTH + 1)}\n2. Short`)).toEqual({ total: 2, elided: 1 });
	});

	test("scopes the count to the Steps section", () => {
		const plan = ["## Context", "- prose", "## Steps", "- One", "- Two"].join("\n");
		expect(planStepSummary(plan)).toEqual({ total: 2, elided: 0 });
	});

	test("matches step text ignoring case, surrounding space, and collapsed whitespace", () => {
		expect(matchesStepText("Add  the cache", " add the CACHE ")).toBe(true);
		expect(matchesStepText("Add the cache", "Wire it")).toBe(false);
	});

	test("does not let two long steps answer for each other", () => {
		const long = "x".repeat(MAX_STEP_LENGTH + 40);
		const shown = elideStep(long);
		// The guard compares the file's own words: two steps that share an elision are different
		// steps, and only the todo bridge shortens a text before comparing it.
		expect(matchesStepText(long, shown)).toBe(false);
		expect(matchesStepText(long, long)).toBe(true);
		expect(matchesStepText(long, `${"x".repeat(MAX_STEP_LENGTH + 20)}`)).toBe(false);
	});
});

describe("step status edits", () => {
	test("marks a numbered step done and leaves its text alone", () => {
		const plan = ["1. Read the parser", "2. Add a tokenizer"].join("\n");
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe(
			"1. Read the parser\n2. [x] Add a tokenizer",
		);
	});

	test("adds a checkbox to a plain list item and returns it to pending", () => {
		expect(setStepStatuses("- Do the thing", [{ step: 1, status: "completed" }])).toBe("- [x] Do the thing");
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

	test("reopening drops a DONE marker; completing keeps it", () => {
		const reopened = setStepStatuses("- First [DONE:1]\n- Second", [{ step: 1, status: "pending" }]);
		expect(reopened).toBe("- [ ] First\n- Second");
		expect(extractPlanSteps(reopened as string)).toEqual([pending("First"), pending("Second")]);
		expect(setStepStatuses("- First [DONE:1]", [{ step: 1, status: "completed" }])).toBe("- [x] First [DONE:1]");
	});

	test("a duplicate step takes the last entry", () => {
		const result = setStepStatuses("- One", [
			{ step: 1, status: "completed" },
			{ step: 1, status: "pending" },
		]);
		expect(result).toBe("- [ ] One");
	});

	test("aligns its numbering with extractPlanSteps, repeats included", () => {
		const plan = ["1. Same", "2. same", "3. Other"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([pending("Same"), pending("same"), pending("Other")]);
		// The second occurrence has its own number now, and ticking it leaves the first alone.
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe("1. Same\n2. [x] same\n3. Other");
		expect(setStepStatuses(plan, [{ step: 3, status: "completed" }])).toBe("1. Same\n2. same\n3. [x] Other");
	});

	test("keeps a wrapped step's continuation when the checkbox changes", () => {
		const plan = ["- [ ] First step", "  continues here", "- [ ] Second"].join("\n");
		expect(setStepStatuses(plan, [{ step: 1, status: "completed" }])).toBe(
			["- [x] First step", "  continues here", "- [ ] Second"].join("\n"),
		);
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe(
			["- [ ] First step", "  continues here", "- [x] Second"].join("\n"),
		);
	});

	test("ignores steps inside fences", () => {
		const result = setStepStatuses(["```", "- nope", "```", "- Real"].join("\n"), [{ step: 1, status: "completed" }]);
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

describe("the cap counts items, not distinct texts", () => {
	test("a repeated step is its own item, so 51 items are 51 steps", () => {
		// A 60-bullet section of 11 repeats used to be counted as 49, and the repeats were
		// untracked; `write` and `exit` refuse on this number.
		const repeated = Array.from({ length: MAX_STEPS + 1 }, (_, i) => `${i + 1}. step ${i % 30}`).join("\n");
		expect(planStepSummary(repeated).total).toBe(MAX_STEPS + 1);
		expect(extractPlanSteps(repeated)).toHaveLength(MAX_STEPS);
	});

	test("both occurrences of a repeated step have a number", () => {
		const plan = ["1. Same", "2. same", "3. Other"].join("\n");
		expect(extractPlanSteps(plan)).toEqual([
			{ content: "Same", status: "pending" },
			{ content: "same", status: "pending" },
			{ content: "Other", status: "pending" },
		]);
		expect(setStepStatuses(plan, [{ step: 2, status: "completed" }])).toBe("1. Same\n2. [x] same\n3. Other");
	});
});

describe("a step longer than the display cap", () => {
	test("comes out whole, and the elision belongs to the surface that shows one line", () => {
		const long = "x".repeat(MAX_STEP_LENGTH + 40);
		const [step] = extractPlanSteps(`## Steps\n- [ ] ${long}`);
		expect(step?.content).toBe(long);
		expect(elideStep(long).length).toBe(MAX_STEP_LENGTH);
		expect(elideStep(long).endsWith("…")).toBe(true);
	});

	test("is matched in full, so the line the file holds ticks it", () => {
		// The guard compared `expected` against the shortened text nobody could see.
		const long = "x".repeat(MAX_STEP_LENGTH + 40);
		expect(matchesStepText(long, long)).toBe(true);
		expect(matchesStepText(long, elideStep(long))).toBe(false);
	});
});
