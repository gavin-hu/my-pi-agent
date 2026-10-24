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
