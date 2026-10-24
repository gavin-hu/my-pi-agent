import { describe, expect, test } from "bun:test";
import {
	carryFeedback,
	claimAuthor,
	coerceAnnotations,
	displayFeedback,
	feedbackSummary,
	formatFeedback,
	MAX_ANNOTATIONS,
	MAX_AUTHOR_LENGTH,
	normalizeAuthor,
	parseFeedback,
	stripFeedback,
} from "./feedback.ts";
import { planBlocks } from "./blocks.ts";

describe("plan feedback codec", () => {
	const plan = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";

	test("strips stored feedback lines and leaves the body", () => {
		expect(stripFeedback("- one\n> [!REVIEW] a note\n- two")).toBe("- one\n- two");
		expect(stripFeedback("a\n  > [!REVIEW]\nb")).toBe("a\nb");
	});

	test("keeps a marker-looking line inside a fenced code block", () => {
		const fenced = "```md\n> [!REVIEW] documentation\n```";
		expect(stripFeedback(fenced)).toBe(fenced);
	});

	test("places a comment after the block it is anchored to", () => {
		expect(formatFeedback(plan, [{ anchor: 3, comment: "too vague" }])).toBe(
			"# Title\n\n## Steps\n- [ ] one\n> [!REVIEW] too vague\n- [ ] two\n",
		);
	});

	test("groups several comments on one block in order", () => {
		const saved = formatFeedback(plan, [
			{ anchor: 3, comment: "first" },
			{ anchor: 3, comment: "second" },
		]);
		expect(saved).toContain("- [ ] one\n> [!REVIEW] first\n> [!REVIEW] second\n- [ ] two");
	});

	test("never splits a fenced code block", () => {
		const fenced = "```ts\nconst x = 1;\n```\nafter\n";
		const saved = formatFeedback(fenced, [{ anchor: 1, comment: "rename x" }]);
		expect(saved).toBe("```ts\nconst x = 1;\n```\n> [!REVIEW] rename x\nafter\n");
	});

	test("collapses a multi-line comment to one marker line", () => {
		expect(formatFeedback("- one", [{ anchor: 0, comment: "line one\nline two" }])).toBe(
			"- one\n> [!REVIEW] line one line two",
		);
	});

	test("drops empty comments and clears stored feedback when none remain", () => {
		expect(formatFeedback("- one\n> [!REVIEW] old", [])).toBe("- one");
		expect(formatFeedback("- one", [{ anchor: 0, comment: "   " }])).toBe("- one");
	});

	test("writes into an empty plan", () => {
		expect(formatFeedback("", [{ anchor: 0, comment: "start over" }])).toBe("> [!REVIEW] start over");
	});

	test("is idempotent across repeated saves", () => {
		const annotations = [
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		];
		const once = formatFeedback(plan, annotations);
		expect(formatFeedback(once, annotations)).toBe(once);
	});

	test("recovers the anchor and comment written by formatFeedback", () => {
		const saved = formatFeedback(plan, [
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
		expect(parseFeedback(saved)).toEqual([
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
	});

	test("returns nothing when there is no feedback", () => {
		expect(parseFeedback(plan)).toEqual([]);
	});

	test("anchors a leading comment to the first block", () => {
		expect(parseFeedback("> [!REVIEW] top\n# Title")).toEqual([{ anchor: 0, comment: "top" }]);
	});

	test("ignores a marker-looking line inside a fenced code block", () => {
		expect(parseFeedback("```md\n> [!REVIEW] documentation\n```")).toEqual([]);
	});

	test("leaves a plan whose code block documents the marker unchanged", () => {
		const fenced = "# Title\n\n```md\n> [!REVIEW] documentation\n```\n\n- [ ] step\n";
		const saved = formatFeedback(fenced, [{ anchor: 6, comment: "real" }]);
		expect(stripFeedback(saved)).toBe(fenced);
		expect(parseFeedback(saved)).toEqual([{ anchor: 6, comment: "real" }]);
	});

	test("numbers comments and includes a short quote", () => {
		const summary = feedbackSummary([
			{ anchor: 0, quote: "token bucket", comment: "burst case?" },
			{ anchor: 1, comment: "add a test" },
		]);
		expect(summary).toBe('1. On "token bucket": burst case?\n2. add a test');
	});

	test("truncates a long quote", () => {
		const summary = feedbackSummary([{ anchor: 0, quote: "x".repeat(200), comment: "note" }]);
		expect(summary).toContain("…");
		expect(summary).toContain("note");
	});

	test("accepts a well-formed annotation payload and drops an empty comment", () => {
		expect(coerceAnnotations([{ anchor: 2, quote: "q", comment: "c" }])).toEqual([
			{ anchor: 2, quote: "q", comment: "c" },
		]);
		expect(coerceAnnotations([{ anchor: 2, comment: "  " }])).toEqual([]);
	});

	test("rejects a non-array or a malformed entry", () => {
		expect(coerceAnnotations("nope")).toBeUndefined();
		expect(coerceAnnotations([{ anchor: -1, comment: "c" }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1.5, comment: "c" }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1 }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1, comment: "c", quote: 3 }])).toBeUndefined();
	});

	test("caps the annotation count", () => {
		const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, () => ({ anchor: 0, comment: "c" }));
		expect(coerceAnnotations(many)).toBeUndefined();
	});
});

describe("authored review comments", () => {
	const plan = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";

	test("stores a reviewer's comment with its author", () => {
		expect(formatFeedback(plan, [{ anchor: 3, comment: "burst case?" }], { author: "alice" })).toBe(
			"# Title\n\n## Steps\n- [ ] one\n> [!REVIEW] @alice: burst case?\n- [ ] two\n",
		);
	});

	test("reads the author back and leaves the owner's marker untagged", () => {
		const saved = "# Title\n> [!REVIEW] @alice: mine\n> [!REVIEW] the owner's";
		expect(parseFeedback(saved)).toEqual([
			{ anchor: 0, comment: "mine", author: "alice" },
			{ anchor: 0, comment: "the owner's" },
		]);
	});

	test("saving as one reviewer keeps another reviewer's comment", () => {
		const withAlice = formatFeedback(plan, [{ anchor: 3, comment: "alice's" }], { author: "alice" });
		const withBoth = formatFeedback(withAlice, [{ anchor: 4, comment: "bob's" }], { author: "bob" });
		expect(withBoth).toContain("> [!REVIEW] @alice: alice's\n- [ ] two");
		expect(withBoth).toContain("- [ ] two\n> [!REVIEW] @bob: bob's");
		const ownerSave = formatFeedback(withBoth, [{ anchor: 3, comment: "mine" }]);
		expect(ownerSave).toContain("> [!REVIEW] @alice: alice's");
		expect(ownerSave).toContain("> [!REVIEW] @bob: bob's");
		expect(ownerSave).toContain("> [!REVIEW] mine");
	});

	test("a reviewer clearing their comments leaves the others", () => {
		const withAlice = formatFeedback(plan, [{ anchor: 3, comment: "alice's" }], { author: "alice" });
		expect(formatFeedback(withAlice, [], { author: "alice" })).toBe(plan);
	});

	test("a name is one safe line, and the owner is the empty one", () => {
		expect(normalizeAuthor("  @@Alice  Smith: ")).toBe("Alice Smith");
		expect(normalizeAuthor("x".repeat(MAX_AUTHOR_LENGTH + 20))).toHaveLength(MAX_AUTHOR_LENGTH);
		expect(normalizeAuthor("  :  ")).toBe("");
		expect(normalizeAuthor(undefined)).toBe("");
		expect(normalizeAuthor(7)).toBe("");
	});

	test("the summary names who said what", () => {
		expect(
			feedbackSummary([
				{ anchor: 0, comment: "add a rollback", author: "alice" },
				{ anchor: 1, comment: "and a test" },
			]),
		).toBe("1. @alice: add a rollback\n2. and a test");
	});

	test("an author in a payload is normalized, and a non-string one is refused", () => {
		expect(coerceAnnotations([{ anchor: 1, comment: "c", author: "@alice" }])).toEqual([
			{ anchor: 1, comment: "c", author: "alice" },
		]);
		expect(coerceAnnotations([{ anchor: 1, comment: "c", author: "   " }])).toEqual([{ anchor: 1, comment: "c" }]);
		expect(coerceAnnotations([{ anchor: 1, comment: "c", author: 3 }])).toBeUndefined();
	});

	test("an authored marker inside a fence is not a comment", () => {
		const fenced = "```md\n> [!REVIEW] @alice: documentation\n```";
		expect(parseFeedback(fenced)).toEqual([]);
		expect(stripFeedback(fenced)).toBe(fenced);
	});

	test("carries a comment onto the block that still matches", () => {
		const previous = "# Title\n\n## Steps\n- [ ] one\n> [!REVIEW] @alice: keep me\n- [ ] two\n";
		const rewritten = "# Title\n\n## Intro\nA new paragraph.\n\n## Steps\n- [ ] one\n- [ ] two\n";
		expect(carryFeedback(previous, rewritten)).toContain("- [ ] one\n> [!REVIEW] @alice: keep me\n- [ ] two");
	});

	test("keeps a comment on a step whose text was reworded", () => {
		const previous = "- [ ] one\n> [!REVIEW] @alice: about one\n- [ ] two";
		const rewritten = "- [ ] one, restated differently\n- [ ] two";
		expect(carryFeedback(previous, rewritten)).toBe(
			"- [ ] one, restated differently\n> [!REVIEW] @alice: about one\n- [ ] two",
		);
	});

	test("keeps two comments on two identical steps apart", () => {
		const previous = "- [ ] same\n> [!REVIEW] first\n- [ ] same\n> [!REVIEW] second";
		expect(carryFeedback(previous, "- [ ] same\n- [ ] same")).toBe(previous);
	});

	test("moves a comment to its section's end when the step is gone", () => {
		const previous = "## Steps\n- [ ] one\n> [!REVIEW] about one\n- [ ] two";
		const rewritten = "## Steps\n- [ ] two";
		expect(carryFeedback(previous, rewritten)).toBe("## Steps\n- [ ] two\n> [!REVIEW] about one");
	});

	test("falls back to the end of the plan when the section is gone", () => {
		const previous = "## Steps\n- [ ] one\n> [!REVIEW] @alice: about one";
		const rewritten = "# Plan\n\nBody only";
		expect(carryFeedback(previous, rewritten)).toBe(`${rewritten}\n> [!REVIEW] @alice: about one`);
	});

	test("never duplicates a marker the rewritten plan carried itself", () => {
		const previous = "- [ ] one\n> [!REVIEW] @alice: keep me";
		const rewritten = "- [ ] one\n> [!REVIEW] @alice: keep me";
		expect(carryFeedback(previous, rewritten)).toBe(previous);
	});

	test("a plan with no comments is returned stripped of any marker", () => {
		expect(carryFeedback("- [ ] one", "- [ ] one\n> [!REVIEW] stale")).toBe("- [ ] one");
	});

	test("keeps a carried comment beside the block, not the blank line after it", () => {
		// A plan as a refinement reads it: a blank line between sections and a
		// trailing newline, so a placement at "the section's end" lands on neither.
		const previous = "# Plan\n\n## Steps\n- [ ] one\n- [ ] two\n> [!REVIEW] about two\n\n## Notes\nGreen.\n";
		const rewritten = "# Plan\n\n## Steps\n- [ ] one\n\n## Notes\nGreen.\n";
		expect(carryFeedback(previous, rewritten)).toBe(
			"# Plan\n\n## Steps\n- [ ] one\n> [!REVIEW] about two\n\n## Notes\nGreen.\n",
		);
	});

	test("keeps a carried comment beside the plan's last block when its section is gone", () => {
		const previous = "# Plan\n\n## Steps\n- [ ] one\n> [!REVIEW] about one\n\n## Notes\nGreen.\n";
		expect(carryFeedback(previous, "# Plan\n\nBody only\n")).toBe("# Plan\n\nBody only\n> [!REVIEW] about one\n");
	});

	test("keeps a reworded step's comment when a blank line above it moved", () => {
		// A blank line is a block too, so counting positions across every block moved
		// a comment onto the step below it as soon as one was added or removed above.
		const previous = "## Steps\n- [ ] one\n\n- [ ] two\n> [!REVIEW] about two\n- [ ] three";
		const rewritten = "## Steps\n- [ ] one\n- [ ] two, restated\n- [ ] three";
		expect(carryFeedback(previous, rewritten)).toBe(
			"## Steps\n- [ ] one\n- [ ] two, restated\n> [!REVIEW] about two\n- [ ] three",
		);
	});

	test("writes a comment anchored to a blank line beside the block above it", () => {
		// An anchor can name blank space: an older marker, or a hand-edited file.
		// Saving places it beside the block, so the page reads it back as a thread.
		const saved = formatFeedback("## Steps\n- [ ] one\n\n## Notes\nx", [{ anchor: 2, comment: "c" }]);
		expect(saved).toBe("## Steps\n- [ ] one\n> [!REVIEW] c\n\n## Notes\nx");
		expect(parseFeedback(saved)).toEqual([{ anchor: 1, comment: "c" }]);
	});

	// Two `## Notes` are two sections: a comment belongs to the one it was written in,
	// which is the occurrence rule the codec and the review's digest comparison share.
	test("keeps two same-titled sections' comments apart", () => {
		const previous = "## Notes\nfirst\n> [!REVIEW] on the first\n\n## Notes\nsecond\n> [!REVIEW] on the second";
		const rewritten = "## Notes\nfirst, restated\n\n## Notes\nsecond, restated";
		expect(carryFeedback(previous, rewritten)).toBe(
			"## Notes\nfirst, restated\n> [!REVIEW] on the first\n\n## Notes\nsecond, restated\n> [!REVIEW] on the second",
		);
	});

	test("moves a deleted same-titled section's comments onto the survivor", () => {
		// Occurrence 0 of the new plan is a different section from occurrence 0 of the
		// old, so a section that disappears hands its comments to the one that took its
		// place. Recorded as today's behaviour, not endorsed: changing it is a
		// behaviour change, so this test is here to notice one.
		const previous = "## Notes\nfirst\n> [!REVIEW] on the first\n\n## Notes\nsecond\n> [!REVIEW] on the second";
		expect(carryFeedback(previous, "## Notes\nsecond")).toBe(
			"## Notes\nsecond\n> [!REVIEW] on the first\n> [!REVIEW] on the second",
		);
	});

	test("reads a marker that follows a blank line onto the block above it", () => {
		expect(parseFeedback("## Steps\n- [ ] one\n\n> [!REVIEW] about one\n## Notes\nx")).toEqual([
			{ anchor: 1, comment: "about one" },
		]);
	});

	test("reads a marker above the plan's leading blanks onto its first block", () => {
		expect(parseFeedback("> [!REVIEW] top\n\n# Title\n")).toEqual([{ anchor: 1, comment: "top" }]);
	});

	test("reads back only anchors the page can attach a thread to", () => {
		const stored = [
			"# Plan\n\n## Steps\n- [ ] one\n> [!REVIEW] first\n- [ ] two\n\n> [!REVIEW] second\n\n",
			"## Notes\nthe end\n\n> [!REVIEW] third\n",
		].join("");
		const attachable = planBlocks(stripFeedback(stored))
			.filter((block) => block.kind !== "blank")
			.map((block) => block.start);
		const annotations = parseFeedback(stored);

		expect(annotations.length).toBe(3);
		for (const annotation of annotations) expect(attachable).toContain(annotation.anchor);
	});
});

describe("who a reviewer write is signed by", () => {
	test("the first post claims the name it signs", () => {
		expect(claimAuthor({ taken: [] }, [{ anchor: 1, comment: "c", author: "@Alice" }])).toEqual({ name: "Alice" });
	});

	test("a bound link keeps its name, even for a post that signs nothing", () => {
		expect(claimAuthor({ bound: "alice" }, [])).toEqual({ name: "alice" });
		expect(claimAuthor({ bound: "alice" }, [{ anchor: 1, comment: "c" }])).toEqual({ name: "alice" });
	});

	test("a bound link refuses a post signed with someone else's name", () => {
		const claim = claimAuthor({ bound: "alice" }, [{ anchor: 1, comment: "c", author: "priya" }]);
		expect(claim).toMatchObject({ status: 409 });
		expect("message" in claim ? claim.message : "").toContain("@alice");
	});

	test("a name another live link holds cannot be claimed", () => {
		expect(claimAuthor({ taken: ["alice"] }, [{ anchor: 1, comment: "c", author: "alice" }])).toMatchObject({
			status: 400,
		});
	});

	test("an unsigned post claims nothing", () => {
		expect(claimAuthor({ taken: [] }, [{ anchor: 1, comment: "c" }])).toMatchObject({ status: 400 });
	});

	test("one post cannot sign two names", () => {
		const claim = claimAuthor({ taken: [] }, [
			{ anchor: 1, comment: "c", author: "alice" },
			{ anchor: 2, comment: "d", author: "priya" },
		]);
		expect(claim).toMatchObject({ status: 409 });
	});
});

describe("showing stored comments", () => {
	test("names a reviewer and marks the owner's own comment", () => {
		const plan = "- [ ] one\n> [!REVIEW] @alice: theirs\n> [!REVIEW] mine";
		expect(displayFeedback(plan)).toBe("- [ ] one\n> @alice: theirs\n> Review: mine");
	});

	test("leaves a plan with no comments alone", () => {
		const plan = "# Plan\n- [ ] one";
		expect(displayFeedback(plan)).toBe(plan);
	});

	test("keeps a fenced example of the marker untouched", () => {
		const fenced = "```md\n> [!REVIEW] @alice: documentation\n```";
		expect(displayFeedback(fenced)).toBe(fenced);
	});

	test("round-trips through the stored form", () => {
		const stored = formatFeedback("- [ ] one", [{ anchor: 0, comment: "note" }], { author: "alice" });
		expect(displayFeedback(stored)).toBe("- [ ] one\n> @alice: note");
		expect(parseFeedback(stored)).toEqual([{ anchor: 0, comment: "note", author: "alice" }]);
	});
});
