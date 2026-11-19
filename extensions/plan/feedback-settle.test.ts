/**
 * The owner settling a reviewer's note: a flag changes, the words do not.
 *
 * The browser's Resolve now appears on a teammate's card, and the store must honour it without
 * letting the owner rewrite her note. These cases drive `formatFeedback`'s settle list: author,
 * anchor and text must all agree, the match is consumed once in list order, and only the tag's
 * flag moves — the body stays byte-identical, including a note that had also moved.
 */

import { describe, expect, test } from "bun:test";
import { formatFeedback, readFeedback, stripFeedback, type PlanAnnotation } from "./feedback.ts";

/** A plan with a heading, two sections, and a note by priya on each section's paragraph. */
const PLAN = [
	"# Plan",
	"",
	"## First",
	"",
	"first paragraph",
	"> [!REVIEW] @priya: why one?",
	"",
	"## Second",
	"",
	"second paragraph",
	"> [!REVIEW moved] @priya: moved note",
].join("\n");

/** Priya's stored notes, in document order. */
function priya(plan = PLAN): PlanAnnotation[] {
	return readFeedback(plan).annotations.filter((annotation) => annotation.author === "priya");
}

/** The owner's write: no own annotations, and the given settlements. */
function settle(plan: string, entries: readonly PlanAnnotation[]): string {
	return formatFeedback(plan, [], { author: "", settle: entries });
}

describe("the owner settles a reviewer's note", () => {
	test("resolves a tagged note and leaves its words and its moved flag alone", () => {
		const note = priya()[0] as PlanAnnotation;
		const out = settle(PLAN, [{ ...note, resolved: true }]);
		const back = readFeedback(out).annotations;
		expect(back.map((annotation) => annotation.comment)).toEqual(["why one?", "moved note"]);
		expect(back[0]?.resolved).toBe(true);
		// The body is the same bytes; only the tag gained a word.
		expect(stripFeedback(out)).toBe(stripFeedback(PLAN));
		expect(out).toContain("[!REVIEW resolved] @priya: why one?");
	});

	test("carries a moved note's flag in markerLine's order", () => {
		const note = priya()[1] as PlanAnnotation;
		const out = settle(PLAN, [{ ...note, resolved: true }]);
		expect(out).toContain("[!REVIEW moved resolved] @priya: moved note");
		expect(stripFeedback(out)).toBe(stripFeedback(PLAN));
	});

	test("reopening clears the flag and keeps the text", () => {
		const resolvedPlan = PLAN.replace("[!REVIEW] @priya: why one?", "[!REVIEW resolved] @priya: why one?");
		const note = priya(resolvedPlan)[0] as PlanAnnotation;
		const out = settle(resolvedPlan, [{ anchor: note.anchor, author: "priya", comment: note.comment }]);
		expect(readFeedback(out).annotations[0]?.resolved).toBeUndefined();
		expect(out).toContain("[!REVIEW] @priya: why one?");
	});

	test("matches text after sanitising, and refuses the near miss", () => {
		const note = priya()[0] as PlanAnnotation;
		// Trailing spaces and a newline collapse to the stored line: the same note.
		const padded = settle(PLAN, [{ ...note, comment: "  why one?  \n", resolved: true }]);
		expect(readFeedback(padded).annotations[0]?.resolved).toBe(true);
		// One word different is not the same note: no flag is applied and no text is written.
		const changed = settle(PLAN, [{ ...note, comment: "why one now?", resolved: true }]);
		expect(readFeedback(changed).annotations[0]?.resolved).toBeUndefined();
		expect(stripFeedback(changed)).toBe(stripFeedback(PLAN));
	});

	test("pairs duplicate notes first-to-first", () => {
		const plan = [
			"# Plan",
			"",
			"## First",
			"",
			"first paragraph",
			"> [!REVIEW] @priya: same",
			"> [!REVIEW] @priya: same",
		].join("\n");
		const notes = priya(plan);
		expect(notes).toHaveLength(2);
		const out = settle(plan, [{ ...notes[0]!, resolved: true }, { ...notes[1]! }]);
		const flags = readFeedback(out).annotations.map((annotation) => annotation.resolved);
		expect(flags).toEqual([true, undefined]);
	});

	test("keeps another writer's note untouched", () => {
		const plan = PLAN.replace("[!REVIEW] @priya: why one?", "[!REVIEW] @alice: why one?");
		const out = settle(plan, [
			{ anchor: priya(plan)[0]?.anchor ?? 0, author: "priya", comment: "why one?", resolved: true },
		]);
		expect(readFeedback(out).annotations[0]?.resolved).toBeUndefined();
		expect(stripFeedback(out)).toBe(stripFeedback(plan));
	});

	test("a reviewer's write ignores the settle list", () => {
		const note = priya()[0] as PlanAnnotation;
		const out = formatFeedback(PLAN, [], { author: "alice", settle: [{ ...note, resolved: true }] });
		expect(readFeedback(out).annotations[0]?.resolved).toBeUndefined();
	});
});
