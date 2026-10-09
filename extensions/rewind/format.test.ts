import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	PROMPT_WIDTH,
	formatChangeSummary,
	formatRelativeTime,
	formatRestoreText,
	formatRewindDetail,
	formatRewindListText,
	formatRewindRow,
	previewDiffText,
	summarizePrompt,
} from "./format.ts";

describe("formatRelativeTime", () => {
	const now = 1_000_000;
	test("scales from seconds to days", () => {
		expect(formatRelativeTime(now - 3_000, now)).toBe("3s ago");
		expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
	});
});

describe("summarizePrompt", () => {
	test("takes the first non-empty line and collapses whitespace", () => {
		expect(summarizePrompt("  \n  fix the   list\t\nmore detail")).toBe("fix the list");
		expect(summarizePrompt("\n\n")).toBeUndefined();
		expect(summarizePrompt("")).toBeUndefined();
	});

	test("truncates a long prompt to the storage width", () => {
		const summary = summarizePrompt("x".repeat(PROMPT_WIDTH + 20));
		expect(summary).toBeDefined();
		expect(visibleWidth(summary as string)).toBeLessThanOrEqual(PROMPT_WIDTH);
		expect((summary as string).endsWith("…")).toBe(true);
	});
});

describe("formatRewindRow", () => {
	const now = 1_000_000;

	test("marks a code snapshot and right-aligns the age", () => {
		const row = formatRewindRow("fix the list", true, now - 120_000, now, 40);
		expect(row.startsWith("◆ ")).toBe(true);
		expect(row).toContain("fix the list");
		expect(row).toMatch(/2m ago$/);
		expect(visibleWidth(row)).toBeLessThanOrEqual(40);
	});

	test("leaves the marker blank for a conversation-only point", () => {
		const row = formatRewindRow("explain this", false, now - 3_000, now, 40);
		expect(row.startsWith("◆")).toBe(false);
		expect(row).toMatch(/3s ago$/);
	});

	test("falls back for an empty summary and clamps a very narrow width", () => {
		expect(formatRewindRow(undefined, false, now, now, 40)).toContain("(no text)");
		const row = formatRewindRow("x".repeat(200), true, now, now, 12);
		expect(visibleWidth(row)).toBeLessThanOrEqual(12);
	});
});

describe("formatRewindDetail", () => {
	test("distinguishes conversation-only from code points", () => {
		expect(formatRewindDetail(false)).toBe("conversation only");
		expect(formatRewindDetail(true, "abc")).toBe("code snapshot #abc");
		expect(formatRewindDetail(true)).toBe("code snapshot");
	});
});

describe("formatRewindListText", () => {
	test("reports an empty timeline", () => {
		expect(formatRewindListText([])).toContain("No prompts to rewind to yet.");
	});

	test("lists points newest first with their marker", () => {
		const text = formatRewindListText([
			{ summary: "second", timestamp: 2000, hasSnapshot: true },
			{ summary: "first", timestamp: 1000, hasSnapshot: false },
		]);
		expect(text).toContain("2 prompts (newest first):");
		expect(text.split("\n")[1]).toContain("second");
		expect(text.split("\n")[1]).toContain("◆");
		expect(text.split("\n")[2]).not.toContain("◆");
	});
});

describe("previewDiffText", () => {
	test("elides beyond the line cap", () => {
		const diff = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
		const preview = previewDiffText(diff, 5);
		expect(preview.split("\n")).toHaveLength(6);
		expect(preview).toContain("25 more lines");
	});

	test("returns a short diff unchanged", () => {
		expect(previewDiffText("a\nb", 5)).toBe("a\nb");
	});
});

describe("formatChangeSummary and formatRestoreText", () => {
	test("change summary pluralizes and drops a zero created count", () => {
		expect(formatChangeSummary(1, 0)).toBe("1 file changed");
		expect(formatChangeSummary(2, 1)).toBe("2 files changed, 1 created");
	});

	test("restore text reports changes and a safety snapshot", () => {
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 2, removed: 1 })).toContain(
			"2 files changed, 1 removed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, safety: "s" })).toContain(
			"safety snapshot #s",
		);
	});
});
