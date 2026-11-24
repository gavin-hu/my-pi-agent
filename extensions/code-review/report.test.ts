import { describe, expect, test } from "bun:test";
import { NOTICE_ROWS, reviewNotice, REVIEW_MARKER } from "./report.ts";

describe("the notice a send reaches the model with", () => {
	test("carries the marker, a counted headline, one anchored row each, and the hint", () => {
		const notice = reviewNotice([
			{ id: "r1", at: 1, comments: [{ rel: "a.ts", line: 4, body: "guard this" }] },
			{ id: "r1", at: 2, comments: [{ rel: "b.ts", line: 9, body: "and this" }] },
		]);
		expect(notice.content.split("\n")).toEqual([
			REVIEW_MARKER,
			"2 review comments sent:",
			"a.ts:4 — guard this",
			"b.ts:9 — and this",
			'Run `code_review` action "comments" for all of them.',
		]);
		expect(notice.details.source).toBe("code-review");
		expect(notice.details.items).toHaveLength(2);
		expect(notice.display).toBe(true);
	});

	test("names a span where the comment names one", () => {
		const notice = reviewNotice([
			{ id: "r1", at: 1, comments: [{ rel: "a.ts", line: 4, endLine: 9, body: "these six" }] },
		]);
		expect(notice.content.split("\n")[2]).toBe("a.ts:4-9 — these six");
		expect(notice.details.items?.[0].label).toBe("a.ts:4-9");
	});

	test("caps the rows and counts the rest", () => {
		const comments = Array.from({ length: NOTICE_ROWS + 3 }, (_, index) => ({
			rel: "a.ts",
			line: index + 1,
			body: `note ${index}`,
		}));
		const notice = reviewNotice([{ id: "r1", at: 1, comments }]);
		expect(notice.content).toContain("… 3 more");
		expect(notice.content.split("\n").filter((line) => line.startsWith("a.ts:"))).toHaveLength(NOTICE_ROWS);
		expect(notice.details.items).toHaveLength(NOTICE_ROWS);
	});

	test("clips a long body and keeps a path to one line", () => {
		const notice = reviewNotice([
			{ id: "r1", at: 1, comments: [{ rel: "src/a b.ts", line: 1, body: `${"x".repeat(200)}\nsecond line` }] },
		]);
		const row = notice.content.split("\n")[2];
		expect(row).toContain("src/a b.ts:1 — ");
		expect(row).not.toContain("\n");
		expect(row.length).toBeLessThan(200);
	});

	test("a single comment reads as one, not one comment's plural", () => {
		const notice = reviewNotice([{ id: "r1", at: 1, comments: [{ rel: "a.ts", line: 1, body: "x" }] }]);
		expect(notice.content.split("\n")[1]).toBe("1 review comment sent:");
	});
});
