import { describe, expect, test } from "bun:test";
import { changedSections, sameSections, sectionDigests } from "./plan-text.ts";

describe("sectionDigests", () => {
	test("keeps one digest per heading section, in document order", () => {
		const digests = sectionDigests(["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n"));
		expect(digests.map((section) => section.title)).toEqual(["Plan", "Goal", "Steps"]);
		for (const section of digests) expect(section.digest).toMatch(/^[0-9a-f]{64}$/);
	});

	test("labels a section the way the review screen does", () => {
		const digests = sectionDigests(["## **Goal**", "Ship it."].join("\n"));
		expect(digests.map((section) => section.title)).toEqual(["Goal"]);
	});

	test("digests the plan with its stored review comments removed", () => {
		const plain = ["# Plan", "## Goal", "Ship it."].join("\n");
		const withComment = ["# Plan", "## Goal", "Ship it.", "> [!REVIEW] make it concrete"].join("\n");
		expect(sectionDigests(withComment)).toEqual(sectionDigests(plain));
	});
});

describe("sameSections", () => {
	const plan = ["# Plan", "## Goal", "Ship it."].join("\n");

	test("reports an identical baseline as unchanged", () => {
		expect(sameSections(sectionDigests(plan), sectionDigests(plan))).toBe(true);
	});

	test("reports a changed section, and a different section count", () => {
		expect(sameSections(sectionDigests(plan), sectionDigests(plan.replace("Ship it.", "Ship it now.")))).toBe(false);
		expect(sameSections(sectionDigests(plan), sectionDigests(`${plan}\n## Risks\n- stale reads`))).toBe(false);
	});
});

describe("changedSections", () => {
	const before = ["# Plan", "## Goal", "Ship it.", "## Steps", "- [ ] One"].join("\n");

	test("returns nothing for an identical plan", () => {
		expect(changedSections(sectionDigests(before), before)).toEqual([false, false, false]);
	});

	test("marks a section whose text changed", () => {
		expect(changedSections(sectionDigests(before), before.replace("Ship it.", "Ship it well."))).toEqual([
			false,
			true,
			false,
		]);
	});

	test("marks a new section", () => {
		expect(changedSections(sectionDigests(before), `${before}\n## Risks\n- stale reads`)).toEqual([
			false,
			false,
			false,
			true,
		]);
	});

	test("does not mark a removed section", () => {
		// The array follows the current plan, so a dropped section only shortens it.
		expect(changedSections(sectionDigests(before), ["# Plan", "## Goal", "Ship it."].join("\n"))).toEqual([
			false,
			false,
		]);
	});

	test("flags a duplicate title by occurrence, not by title", () => {
		const previous = ["## Steps", "- One", "## Steps", "- Two"].join("\n");
		// Only the second occurrence changed, so only it is flagged.
		expect(
			changedSections(sectionDigests(previous), ["## Steps", "- One", "## Steps", "- Two more"].join("\n")),
		).toEqual([false, true]);
	});

	test("normalizes an emphasized heading", () => {
		const previous = ["## **Goal**", "Old"].join("\n");
		const current = ["## Goal", "New"].join("\n");
		expect(changedSections(sectionDigests(previous), current)).toEqual([true]);
	});

	test("flags nothing on a first review", () => {
		// A plan this branch never showed has no baseline; every section is new, and
		// marking them all would claim the whole plan changed.
		expect(changedSections(undefined, before)).toEqual([false, false, false]);
	});

	test("a tab and its four spaces are the same content", () => {
		const tabbed = ["## Steps", "- [ ] one", "- [ ] two"].join("\n").replace("- [ ] ", "-\t");
		expect(changedSections(sectionDigests(tabbed), tabbed.replace(/\t/g, "    "))).toEqual([false]);
	});

	test("a stored review comment is not an edit", () => {
		const plan = ["# Plan", "## Goal", "Ship it."].join("\n");
		const commented = ["# Plan", "## Goal", "Ship it.", "> [!REVIEW] make it concrete"].join("\n");
		expect(changedSections(sectionDigests(commented), plan)).toEqual([false, false]);
	});
});
