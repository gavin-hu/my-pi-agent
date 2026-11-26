import { describe, expect, test } from "bun:test";
import { MAX_BASE_LENGTH } from "../scope.ts";
import { DEFAULT_REVIEW_CONFIG, normalizeReviewConfig } from "./config.ts";

describe("the code-review config", () => {
	test("keeps every default when the section is absent", () => {
		expect(normalizeReviewConfig(undefined)).toEqual(DEFAULT_REVIEW_CONFIG);
		expect(DEFAULT_REVIEW_CONFIG).toEqual({ base: "", diffContext: 3, maxDiffLines: 4000, maxFiles: 200 });
	});

	test("takes a base ref trimmed, whole, and an absent one means detect", () => {
		expect(normalizeReviewConfig({ base: "  origin/develop  " }).base).toBe("origin/develop");
		expect(normalizeReviewConfig({ base: "   " }).base).toBe("");
		// The bound is the reader's: a ref this long is refused by name there, not cut here.
		expect(normalizeReviewConfig({ base: "x".repeat(MAX_BASE_LENGTH + 50) }).base).toHaveLength(MAX_BASE_LENGTH + 50);
		expect(normalizeReviewConfig({ base: 42 }).base).toBe("");
	});

	test("clamps the three numbers to their ranges", () => {
		expect(normalizeReviewConfig({ diffContext: 500 }).diffContext).toBe(100);
		expect(normalizeReviewConfig({ diffContext: -4 }).diffContext).toBe(0);
		expect(normalizeReviewConfig({ maxDiffLines: 0 }).maxDiffLines).toBe(1);
		expect(normalizeReviewConfig({ maxDiffLines: "1200" }).maxDiffLines).toBe(1200);
		expect(normalizeReviewConfig({ maxFiles: 0 }).maxFiles).toBe(1);
		expect(normalizeReviewConfig({ maxFiles: 99_999 }).maxFiles).toBe(10_000);
	});

	test("rounds a fraction and ignores a value that is not a number", () => {
		expect(normalizeReviewConfig({ diffContext: 2.6 }).diffContext).toBe(3);
		expect(normalizeReviewConfig({ diffContext: "wide" }).diffContext).toBe(3);
		expect(normalizeReviewConfig({ maxFiles: null }).maxFiles).toBe(200);
	});
});
