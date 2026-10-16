import { describe, expect, test } from "bun:test";
import {
	coerceAnnotations,
	feedbackSummary,
	formatFeedback,
	MAX_ANNOTATIONS,
	parseFeedback,
	stripFeedback,
} from "./feedback.ts";

const PLAN = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";

describe("stripFeedback", () => {
	test("removes stored feedback lines and leaves the body", () => {
		const saved = "- one\n> [!REVIEW] a note\n- two";
		expect(stripFeedback(saved)).toBe("- one\n- two");
	});

	test("tolerates indented and empty markers", () => {
		expect(stripFeedback("a\n  > [!REVIEW]\nb")).toBe("a\nb");
	});

	test("keeps a marker-looking line inside a fenced code block", () => {
		const plan = "```md\n> [!REVIEW] documentation\n```";
		expect(stripFeedback(plan)).toBe(plan);
	});
});

describe("formatFeedback", () => {
	test("places a comment after the block it is anchored to", () => {
		const saved = formatFeedback(PLAN, [{ anchor: 3, comment: "too vague" }]);
		expect(saved).toBe("# Title\n\n## Steps\n- [ ] one\n> [!REVIEW] too vague\n- [ ] two\n");
	});

	test("groups several comments on one block in order", () => {
		const saved = formatFeedback(PLAN, [
			{ anchor: 3, comment: "first" },
			{ anchor: 3, comment: "second" },
		]);
		expect(saved).toContain("- [ ] one\n> [!REVIEW] first\n> [!REVIEW] second\n- [ ] two");
	});

	test("never splits a fenced code block", () => {
		const plan = "```ts\nconst x = 1;\n```\nafter\n";
		const saved = formatFeedback(plan, [{ anchor: 1, comment: "rename x" }]);
		expect(saved).toBe("```ts\nconst x = 1;\n```\n> [!REVIEW] rename x\nafter\n");
	});

	test("collapses a multi-line comment to one marker line", () => {
		const saved = formatFeedback("- one", [{ anchor: 0, comment: "line one\nline two" }]);
		expect(saved).toBe("- one\n> [!REVIEW] line one line two");
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
		const once = formatFeedback(PLAN, annotations);
		expect(formatFeedback(once, annotations)).toBe(once);
	});
});

describe("parseFeedback", () => {
	test("recovers the anchor and comment written by formatFeedback", () => {
		const saved = formatFeedback(PLAN, [
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
		expect(parseFeedback(saved)).toEqual([
			{ anchor: 3, comment: "first" },
			{ anchor: 4, comment: "second" },
		]);
	});

	test("returns nothing when there is no feedback", () => {
		expect(parseFeedback(PLAN)).toEqual([]);
	});

	test("anchors a leading comment to the first block", () => {
		expect(parseFeedback("> [!REVIEW] top\n# Title")).toEqual([{ anchor: 0, comment: "top" }]);
	});

	test("ignores a marker-looking line inside a fenced code block", () => {
		expect(parseFeedback("```md\n> [!REVIEW] documentation\n```")).toEqual([]);
	});
});

describe("feedback round-trip with a fenced marker", () => {
	test("leaves a plan whose code block documents the marker unchanged", () => {
		const plan = "# Title\n\n```md\n> [!REVIEW] documentation\n```\n\n- [ ] step\n";
		const saved = formatFeedback(plan, [{ anchor: 6, comment: "real" }]);
		expect(stripFeedback(saved)).toBe(plan);
		expect(parseFeedback(saved)).toEqual([{ anchor: 6, comment: "real" }]);
	});
});

describe("feedbackSummary", () => {
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
});

describe("coerceAnnotations", () => {
	test("accepts well-formed entries", () => {
		expect(coerceAnnotations([{ anchor: 2, quote: "q", comment: "c" }])).toEqual([
			{ anchor: 2, quote: "q", comment: "c" },
		]);
	});

	test("drops empty comments", () => {
		expect(coerceAnnotations([{ anchor: 2, comment: "  " }])).toEqual([]);
	});

	test("rejects a non-array or a bad entry", () => {
		expect(coerceAnnotations("nope")).toBeUndefined();
		expect(coerceAnnotations([{ anchor: -1, comment: "c" }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1.5, comment: "c" }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1 }])).toBeUndefined();
		expect(coerceAnnotations([{ anchor: 1, comment: "c", quote: 3 }])).toBeUndefined();
	});

	test("caps the entry count", () => {
		const many = Array.from({ length: MAX_ANNOTATIONS + 1 }, () => ({ anchor: 0, comment: "c" }));
		expect(coerceAnnotations(many)).toBeUndefined();
	});
});
