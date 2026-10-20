import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	PROMPT_WIDTH,
	boundDiff,
	formatChangeSummary,
	formatHunkRevertBody,
	formatHunkRevertText,
	formatRelativeTime,
	formatRestoreText,
	formatReviewDetail,
	formatReviewEntryCounts,
	formatReviewListText,
	formatReviewRevertText,
	formatReviewSummary,
	formatRevertAllBody,
	formatRevertOneBody,
	formatRevertSelectedBody,
	formatRewindDetail,
	formatRewindListText,
	formatRewindRow,
	previewDiffText,
	summarizePrompt,
} from "./format.ts";
import type { ReviewEntry } from "./paths.ts";

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
		expect(summarizePrompt(undefined)).toBeUndefined();
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
		expect(row.startsWith("⬥ ")).toBe(true);
		expect(row).toContain("fix the list");
		expect(row).toMatch(/2m ago$/);
		expect(visibleWidth(row)).toBeLessThanOrEqual(40);
	});

	test("leaves the marker blank for a conversation-only point", () => {
		const row = formatRewindRow("explain this", false, now - 3_000, now, 40);
		expect(row.startsWith("⬥")).toBe(false);
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
		expect(text.split("\n")[1]).toContain("⬥");
		expect(text.split("\n")[2]).not.toContain("⬥");
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

	test("restore text names the subset a partial restore covered", () => {
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 1, removed: 0, of: 5 })).toContain(
			"1 of 5 files changed",
		);
		expect(formatRestoreText({ id: "z", commit: "c", root: "/r", changed: 2, removed: 0, of: 4 })).toContain(
			"2 of 4 files changed",
		);
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

/** One review entry with text counts; a rename is built as a literal below. */
function entry(
	path: string,
	change: Exclude<ReviewEntry["change"], "renamed">,
	added: number | null,
	removed: number | null,
): ReviewEntry {
	return { path, change, added, removed };
}

describe("review formatting", () => {
	const entries = [
		entry("src/a.ts", "modified", 12, 3),
		entry("src/new.ts", "added", 4, 0),
		entry("src/old.ts", "deleted", 0, 9),
		entry("assets/logo.png", "modified", null, null),
	];

	test("counts a text row, a binary row, and a zero row", () => {
		expect(formatReviewEntryCounts(entries[0]!)).toBe("+12 −3");
		expect(formatReviewEntryCounts(entries[1]!)).toBe("+4");
		expect(formatReviewEntryCounts(entries[2]!)).toBe("−9");
		expect(formatReviewEntryCounts(entries[3]!)).toBe("bin");
		expect(formatReviewEntryCounts(entry("x", "modified", 0, 0))).toBe("0");
	});

	test("summarizes files, line deltas, and binary presence", () => {
		expect(formatReviewSummary(entries)).toBe("4 files · +16 −12 · bin");
		expect(formatReviewSummary([entries[0]!])).toBe("1 file · +12 −3");
	});

	test("names the selected count after the totals", () => {
		expect(formatReviewSummary(entries, 2)).toBe("4 files · +16 −12 · bin · 2 selected");
		expect(formatReviewSummary([entries[0]!], 1)).toBe("1 file · +12 −3 · 1 selected");
	});

	test("explains each change kind and the row's actions", () => {
		expect(formatReviewDetail(entries[0]!)).toContain("modified since the snapshot");
		expect(formatReviewDetail(entries[1]!)).toContain("reverting deletes it");
		expect(formatReviewDetail(entries[2]!)).toContain("reverting brings it back");
		expect(formatReviewDetail(entries[0]!)).toContain("Enter opens the diff");
	});

	test("lists the changed paths for a headless review", () => {
		const text = formatReviewListText(entries, "fix the list");

		expect(text).toContain('Reviewing after "fix the list" (4 files):');
		expect(text).toContain("M src/a.ts");
		expect(text).toContain("A src/new.ts");
		expect(text).toContain("D src/old.ts");
		expect(text).toContain("+12 −3");
	});

	test("names committed changes in the headless list", () => {
		const text = formatReviewListText(entries, "fix the list", true);

		expect(text).toContain("already committed");
		expect(text).toContain("working tree only");
	});

	test("reports a revert, its safety snapshot, and what is left", () => {
		const summary = { id: "s", commit: "c", root: "/r", changed: 1, removed: 0, safety: "safe" };

		expect(formatReviewRevertText(summary, 2)).toBe("Reverted 1 file. Safety snapshot #safe. 2 files still changed.");
		expect(formatReviewRevertText({ ...summary, safety: undefined }, 0)).toBe("Reverted 1 file. No changes remain.");
	});

	test("names the file, the change, and the safety snapshot in a one-file confirm", () => {
		const body = formatRevertOneBody(entries[0]!, "fix the list", true);

		expect(body).toContain("M — modified since the snapshot");
		expect(body).toContain('to the snapshot taken before "fix the list"');
		expect(body).toContain("undoable with /rewind");
		expect(body).toContain("HEAD and the index are untouched");
		expect(body).not.toContain("already committed");
		expect(formatRevertOneBody(entries[0]!, "fix the list", false)).toContain("cannot be undone");
	});

	test("names the committed case in a one-file confirm", () => {
		const body = formatRevertOneBody(entries[0]!, "fix the list", true, true);

		expect(body).toContain("already committed");
		expect(body).toContain("leaves the commits in place");
	});

	test("summarizes the whole review in an all-files confirm", () => {
		const body = formatRevertAllBody(entries, "fix the list", true);

		expect(body).toContain('Restores 4 files to the snapshot taken before "fix the list"');
		expect(body).toContain("4 files · +16 −12 · bin");
		expect(body).toContain("HEAD and the index are untouched");
		expect(formatRevertAllBody(entries, "fix the list", true, true)).toContain("already committed");
	});

	test("names a selected subset and leaves the other files alone", () => {
		const body = formatRevertSelectedBody(entries.slice(0, 2), "fix the list", true, false);

		expect(body).toContain("Restores 2 selected files");
		expect(body).toContain("Other changed files stay as they are");
		expect(body).toContain("2 files · +16 −3");
		expect(body).toContain("HEAD and the index are untouched");
		expect(formatRevertSelectedBody(entries.slice(0, 2), "fix the list", true, true)).toContain("already committed");
	});
});

describe("rename formatting", () => {
	const renamed: ReviewEntry = {
		path: "after/name.ts",
		change: "renamed",
		from: "before/name.ts",
		added: 9,
		removed: 9,
	};

	test("names the source in the detail, the headless list, and the confirm", () => {
		expect(formatReviewDetail(renamed)).toContain("renamed from before/name.ts");
		expect(formatReviewDetail(renamed)).toContain("reverting moves it back");
		expect(formatReviewListText([renamed], "fix the list")).toContain("R after/name.ts (from before/name.ts)");

		const body = formatRevertOneBody(renamed, "fix the list", true);
		expect(body).toContain("R — renamed from before/name.ts");
		expect(body).toContain('Moves after/name.ts back to before/name.ts as it was before "fix the list"');
	});
});

describe("hunk revert formatting", () => {
	const entry: ReviewEntry = { path: "src/a.ts", change: "modified", added: 5, removed: 4 };

	test("names the selected subset, the rest of the file, and the safety snapshot", () => {
		const body = formatHunkRevertBody(entry, 2, 5, "fix the list", true);

		expect(body).toContain('Reverts 2 of 5 hunks in src/a.ts to the snapshot taken before "fix the list"');
		expect(body).toContain("3 hunks in the file stay as they are.");
		expect(body).toContain("undoable with /rewind");
		expect(formatHunkRevertBody(entry, 5, 5, "fix", false)).toContain("Every hunk in the file is reverted.");
		expect(formatHunkRevertBody(entry, 1, 2, "fix", false)).toContain("1 hunk in the file stays as it is.");
		expect(formatHunkRevertBody(entry, 1, 2, "fix", false)).toContain("cannot be undone");
	});

	test("reports the count, file, safety snapshot, and what is left", () => {
		expect(formatHunkRevertText("src/a.ts", 2, "safe", 3)).toBe(
			"Reverted 2 hunks in src/a.ts. Safety snapshot #safe. 3 files still changed.",
		);
		expect(formatHunkRevertText("src/a.ts", 1, undefined, 0)).toBe("Reverted 1 hunk in src/a.ts. No changes remain.");
	});
});

describe("boundDiff", () => {
	test("expands tabs and strips control characters", () => {
		const lines = boundDiff("+a\tb\u0007c\n context");

		expect(lines[0]).toBe(["+a", "b c"].join(" ".repeat(4)));
		expect(lines[1]).toBe(" context");
		expect(boundDiff("+x\u001b[31my")[0]).not.toContain("\u001b");
	});

	test("returns a placeholder for an empty or binary patch", () => {
		expect(boundDiff("")).toEqual(["No textual diff."]);
		expect(boundDiff("\n\n")).toEqual(["No textual diff."]);
	});

	test("caps long patches and says so", () => {
		const lines = boundDiff(Array.from({ length: 10 }, (_, index) => `+line ${index}`).join("\n"), 4);

		expect(lines).toHaveLength(5);
		expect(lines.at(-1)).toContain("truncated at 4 lines");
	});

	test("caps a very large patch by characters", () => {
		const lines = boundDiff(`+${"x".repeat(20)}`, 10, 5);

		expect(lines.at(-1)).toBe("… diff truncated");
	});
});
