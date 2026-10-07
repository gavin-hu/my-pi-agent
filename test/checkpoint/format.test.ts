import { describe, expect, test } from "bun:test";
import {
	formatCallText,
	formatChangeSummary,
	formatCheckpointLine,
	formatCheckpointText,
	formatRelativeTime,
	formatRestoreText,
	formatSavedText,
	reasonLabel,
} from "../../extensions/checkpoint/format.ts";
import type { Checkpoint } from "../../extensions/checkpoint/types.ts";

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
	return {
		id: "abc",
		ref: "refs/pi/checkpoints/abc",
		commit: "deadbeef",
		tree: "cafe",
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
	test("prefers a label, then the tool, then the reason", () => {
		expect(reasonLabel(makeCheckpoint({ label: "before refactor" }))).toBe("before refactor");
		expect(reasonLabel(makeCheckpoint({ reason: "auto", tool: "edit" }))).toBe("before edit");
		expect(reasonLabel(makeCheckpoint({ reason: "auto" }))).toBe("automatic");
		expect(reasonLabel(makeCheckpoint({ reason: "pre-restore" }))).toBe("before restore");
		expect(reasonLabel(makeCheckpoint({ reason: "manual" }))).toBe("manual");
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

	test("saved and restored text", () => {
		expect(formatSavedText(makeCheckpoint({ id: "z" }))).toContain("#z");
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 2, removed: 1 })).toContain(
			"2 files changed, 1 removed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, safety: "s" })).toContain(
			"safety checkpoint #s",
		);
	});

	test("call text is the bare action for the tool-name prefix", () => {
		expect(formatCallText({ action: "save" })).toBe("save");
		expect(formatCallText(undefined, false)).toBe("…");
		expect(formatCallText(undefined, true)).toBe("");
	});

	test("call text distinguishes operations by target", () => {
		expect(formatCallText({ action: "restore", id: "abc" })).toBe("restore  #abc");
		expect(formatCallText({ action: "diff", id: "last" })).toBe("diff  #last");
		expect(formatCallText({ action: "save", label: "before refactor" })).toBe('save  "before refactor"');
		expect(formatCallText({ action: "list", all: true })).toBe("list  --all");
	});

	test("change summary pluralizes and drops a zero created count", () => {
		expect(formatChangeSummary(1, 0)).toBe("1 file changed");
		expect(formatChangeSummary(2, 1)).toBe("2 files changed, 1 created");
	});
});
