import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	PROMPT_WIDTH,
	formatChangeSummary,
	formatCheckpointChoice,
	formatCheckpointLine,
	formatCheckpointRow,
	formatCheckpointText,
	formatRelativeTime,
	formatRestoreText,
	formatSavedText,
	reasonLabel,
	summarizePrompt,
} from "../../extensions/checkpoint/format.ts";
import type { Checkpoint } from "../../extensions/checkpoint/types.ts";

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		id: "abc",
		ref: "refs/pi/checkpoints/abc",
		commit: "deadbeef",
		reason: "manual",
		timestamp: 1000,
		root: "/repo",
		head: "deadbeef",
		clean: false,
		includeUntracked: true,
		...overrides,
	};
}

describe("formatRelativeTime", () => {
	const now = 1_000_000;
	test("scales from seconds to days", () => {
		expect(formatRelativeTime(now - 3_000, now)).toBe("3s ago");
		expect(formatRelativeTime(now - 120_000, now)).toBe("2m ago");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
	});
});

describe("reasonLabel", () => {
	test("prefers a label, then a prompt, then the reason", () => {
		expect(reasonLabel(makeCheckpoint({ label: "before refactor" }))).toBe("before refactor");
		expect(reasonLabel(makeCheckpoint({ reason: "auto", prompt: "fix the list" }))).toBe('"fix the list"');
		expect(reasonLabel(makeCheckpoint({ reason: "auto" }))).toBe("automatic");
		expect(reasonLabel(makeCheckpoint({ reason: "pre-restore" }))).toBe("before restore");
		expect(reasonLabel(makeCheckpoint({ reason: "manual" }))).toBe("manual");
	});

	test("prefers a label over a prompt", () => {
		expect(reasonLabel(makeCheckpoint({ label: "mine", prompt: "fix the list" }))).toBe("mine");
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

describe("list and confirmations", () => {
	test("lists checkpoints newest first as given", () => {
		const text = formatCheckpointText([makeCheckpoint({ id: "b" }), makeCheckpoint({ id: "a" })], 1000);
		expect(text).toContain("2 checkpoints (newest first):");
		expect(text.split("\n")[1].startsWith("#b")).toBe(true);
	});

	test("reports an empty list", () => {
		expect(formatCheckpointText([], 1000)).toContain("No checkpoints yet");
	});

	test("formats a single line with reason and age", () => {
		expect(formatCheckpointLine(makeCheckpoint({ id: "z", label: "prep" }), 1000)).toBe("#z  prep  0s ago");
	});

	test("formats an id-free row and keeps the time right-aligned", () => {
		const row = formatCheckpointRow(makeCheckpoint({ reason: "auto", prompt: "fix the list" }), 1000, 40);
		expect(row).not.toContain("#");
		expect(row).toContain('"fix the list"');
		expect(row).toMatch(/0s ago$/);
		expect(visibleWidth(row)).toBeLessThanOrEqual(40);
	});

	test("clamps a row to a very narrow width", () => {
		const row = formatCheckpointRow(makeCheckpoint({ prompt: "x".repeat(200) }), 1000, 12);
		expect(visibleWidth(row)).toBeLessThanOrEqual(12);
	});

	test("builds an id-free picker label", () => {
		expect(formatCheckpointChoice(makeCheckpoint({ id: "z", label: "prep" }), 1000)).toBe("prep  ·  0s ago");
	});

	test("saved and restored text", () => {
		expect(formatSavedText(makeCheckpoint({ id: "z" }))).toContain("#z");
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 2, removed: 1 })).toContain(
			"2 files changed, 1 removed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, safety: "s" })).toContain(
			"safety checkpoint #s",
		);
	});

	test("change summary pluralizes and drops a zero created count", () => {
		expect(formatChangeSummary(1, 0)).toBe("1 file changed");
		expect(formatChangeSummary(2, 1)).toBe("2 files changed, 1 created");
	});
});
