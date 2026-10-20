import { describe, expect, test } from "bun:test";
import {
	MODEL_FAILURES,
	formatCheckReport,
	formatCheckSummary,
	formatFailureDetail,
	formatFailureLine,
	formatFailureLocation,
	formatResultSummary,
	formatSourceExcerpt,
} from "./format.ts";
import type { CheckResult, Failure } from "./types.ts";

const FAILURE: Failure = {
	path: "src/a.ts",
	line: 12,
	column: 5,
	message: "expected 1 to be 2",
	command: "bun run test",
};

/** A result fixture. */
function result(overrides: Partial<CheckResult> = {}): CheckResult {
	return {
		target: "all",
		status: "failed",
		commands: ["bun run test"],
		exitCode: 1,
		durationMs: 1200,
		truncated: false,
		failures: [FAILURE],
		tail: "tail one\ntail two",
		...overrides,
	};
}

describe("failure formatting", () => {
	test("names the location and the one-line failure", () => {
		expect(formatFailureLocation(FAILURE)).toBe("src/a.ts:12:5");
		expect(formatFailureLine(FAILURE)).toBe("src/a.ts:12:5 · expected 1 to be 2");
		expect(formatFailureLocation({ message: "x", command: "c", test: "adds" })).toBe("adds");
	});

	test("summarizes each status", () => {
		expect(formatCheckSummary(result({ status: "passed", exitCode: 0, failures: [] }))).toBe(
			"Check passed: bun run test · 1.2s",
		);
		expect(formatCheckSummary(result())).toBe("Check failed: 1 failure · bun run test · 1.2s");
		expect(formatCheckSummary(result({ status: "timeout" }))).toBe("Check timed out: bun run test · 1.2s");
		expect(formatCheckSummary(result({ status: "cancelled" }))).toBe("Check cancelled: bun run test");
		expect(formatCheckSummary(result({ status: "error", error: "no command" }))).toBe(
			"Check failed to run: no command",
		);
	});

	test("keeps the result summary short", () => {
		expect(formatResultSummary(result())).toBe("1 failure · bun run test · 1.2s");
		expect(formatResultSummary(result({ status: "timeout" }))).toBe("timed out · bun run test · 1.2s");
	});

	test("renders a source excerpt with aligned numbers and a target marker", () => {
		const lines = formatSourceExcerpt({
			startLine: 5,
			endLine: 7,
			targetLine: 6,
			lines: ["before", "t\tab", "after"],
		});

		expect(lines).toEqual(["  5 │ before", "> 6 │ t    ab", "  7 │ after"]);
	});

	test("shows the source instead of the tail when it is available", () => {
		const detail = formatFailureDetail(FAILURE, "tail text", {
			ok: true,
			excerpt: { startLine: 12, endLine: 12, targetLine: 12, lines: ["const answer = 42;"] },
		});

		expect(detail).toContain("Source:");
		expect(detail.some((line) => line.includes("> 12 │ const answer = 42;"))).toBe(true);
		expect(detail).not.toContain("tail text");
	});

	test("names why the source is unavailable and keeps the tail", () => {
		const detail = formatFailureDetail(FAILURE, "tail text", { ok: false, reason: "file is missing" });

		expect(detail).toContain("(source unavailable: file is missing)");
		expect(detail).toContain("tail text");
	});

	test("falls back to the tail without a source or a path", () => {
		expect(formatFailureDetail(FAILURE, "tail text")).toContain("tail text");
		expect(
			formatFailureDetail({ ...FAILURE, path: undefined }, "tail text", { ok: false, reason: "no file location" }),
		).not.toContain("source unavailable");
	});

	test("caps the model report and includes the fallback tail", () => {
		const many = Array.from({ length: MODEL_FAILURES + 2 }, (_, index) => ({
			...FAILURE,
			line: index + 1,
		}));
		const report = formatCheckReport(result({ failures: many }));

		expect(report).toContain(`Check failed: ${MODEL_FAILURES + 2} failures`);
		expect(report).toContain(`… 2 more failures in details`);

		const fallback = formatCheckReport(
			result({ failures: [{ message: "Command exited with status 2", command: "make verify" }] }),
		);
		expect(fallback).toContain("Tail:");
		expect(fallback).toContain("tail one");
	});
});
