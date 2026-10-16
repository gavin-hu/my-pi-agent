import { describe, expect, test } from "bun:test";
import {
	diffArgs,
	inMode,
	isDiffMode,
	parseStatusZ,
	parseUnifiedDiff,
	statusLetter,
	type ChangedFile,
	type DiffLine,
} from "./diff.ts";

function kinds(lines: DiffLine[]): string[] {
	return lines.map((line) => line.kind);
}

describe("diffArgs", () => {
	test("maps each mode to its revision arguments", () => {
		expect(diffArgs("head")).toEqual(["HEAD"]);
		expect(diffArgs("staged")).toEqual(["--cached"]);
		expect(diffArgs("worktree")).toEqual([]);
	});
});

describe("isDiffMode", () => {
	test("accepts the three modes and rejects anything else", () => {
		expect(isDiffMode("head")).toBe(true);
		expect(isDiffMode("staged")).toBe(true);
		expect(isDiffMode("worktree")).toBe(true);
		expect(isDiffMode("HEAD")).toBe(false);
		expect(isDiffMode("")).toBe(false);
		expect(isDiffMode(null)).toBe(false);
		expect(isDiffMode(undefined)).toBe(false);
	});
});

describe("parseUnifiedDiff", () => {
	test("numbers added, removed, and context lines", () => {
		const text = [
			"diff --git a/a.ts b/a.ts",
			"index 111..222 100644",
			"--- a/a.ts",
			"+++ b/a.ts",
			"@@ -10,3 +10,4 @@",
			" const a = 1;",
			"-const b = 2;",
			"+const b = 3;",
			"+const c = 4;",
			" ",
			"",
		].join("\n");
		const parsed = parseUnifiedDiff(text, 100);
		expect(parsed.binary).toBe(false);
		expect(parsed.truncated).toBe(false);
		expect(kinds(parsed.lines)).toEqual(["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add", "add", "ctx"]);
		const [, , , , hunk, ctx, del, add, add2, blank] = parsed.lines;
		expect(hunk.text).toBe("@@ -10,3 +10,4 @@");
		expect(ctx).toMatchObject({ text: "const a = 1;", oldNo: 10, newNo: 10 });
		expect(del).toMatchObject({ text: "const b = 2;", oldNo: 11 });
		expect(del.newNo).toBeUndefined();
		expect(add).toMatchObject({ text: "const b = 3;", newNo: 11 });
		expect(add.oldNo).toBeUndefined();
		expect(add2).toMatchObject({ text: "const c = 4;", newNo: 12 });
		expect(blank).toMatchObject({ kind: "ctx", text: "", oldNo: 12, newNo: 13 });
	});

	test("treats --- and +++ inside a hunk as a deletion and an addition", () => {
		const text = ["@@ -1,2 +1,2 @@", "--- keep", "+++ add", "-old", "+new"].join("\n");
		const parsed = parseUnifiedDiff(text, 100);
		expect(parsed.lines.map((line) => [line.kind, line.text])).toEqual([
			["hunk", "@@ -1,2 +1,2 @@"],
			["del", "-- keep"],
			["add", "++ add"],
			["del", "old"],
			["add", "new"],
		]);
	});

	test("marks a no-newline note", () => {
		const text = ["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file", ""].join("\n");
		const parsed = parseUnifiedDiff(text, 100);
		expect(parsed.lines.at(-1)).toMatchObject({ kind: "note", text: "\\ No newline at end of file" });
	});

	test("starts a new file block after a hunk", () => {
		const text = [
			"@@ -1 +1 @@",
			"-a",
			"+b",
			"diff --git a/x b/x",
			"--- a/x",
			"+++ b/x",
			"@@ -5 +5 @@",
			"-c",
			"+d",
		].join("\n");
		const parsed = parseUnifiedDiff(text, 100);
		expect(kinds(parsed.lines)).toEqual(["hunk", "del", "add", "meta", "meta", "meta", "hunk", "del", "add"]);
		expect(parsed.lines[6]).toMatchObject({ kind: "hunk", text: "@@ -5 +5 @@" });
		expect(parsed.lines[7]).toMatchObject({ oldNo: 5 });
	});

	test("detects a binary diff", () => {
		const files = parseUnifiedDiff("diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n", 100);
		expect(files.binary).toBe(true);
		expect(kinds(files.lines)).toContain("meta");

		const patch = parseUnifiedDiff("diff --git a/a.png b/a.png\nGIT binary patch\n", 100);
		expect(patch.binary).toBe(true);
	});

	test("strips CRLF and drops the trailing newline", () => {
		const parsed = parseUnifiedDiff("@@ -1 +1 @@\r\n-a\r\n+b\r\n", 100);
		expect(parsed.lines.map((line) => line.text)).toEqual(["@@ -1 +1 @@", "a", "b"]);
	});

	test("truncates at maxLines and flags it", () => {
		const text = ["@@ -1,3 +1,3 @@", "-a", "+b", " c", " d"].join("\n");
		const parsed = parseUnifiedDiff(text, 3);
		expect(parsed.truncated).toBe(true);
		expect(parsed.lines).toHaveLength(3);
	});

	test("returns nothing for empty input", () => {
		expect(parseUnifiedDiff("", 100)).toEqual({ lines: [], truncated: false, binary: false });
	});
});

describe("parseStatusZ", () => {
	test("parses staged, unstaged, and untracked entries", () => {
		const stdout = " M a.txt\0M  b.txt\0MM c.txt\0?? new file.txt\0";
		expect(parseStatusZ(stdout)).toEqual([
			{ rel: "a.txt", index: " ", worktree: "M", untracked: false },
			{ rel: "b.txt", index: "M", worktree: " ", untracked: false },
			{ rel: "c.txt", index: "M", worktree: "M", untracked: false },
			{ rel: "new file.txt", index: "?", worktree: "?", untracked: true },
		]);
	});

	test("reads a rename as destination then original", () => {
		expect(parseStatusZ("R  new.txt\0old.txt\0")).toEqual([
			{ rel: "new.txt", origRel: "old.txt", index: "R", worktree: " ", untracked: false },
		]);
	});

	test("parses deleted entries on either side", () => {
		expect(parseStatusZ(" D gone.txt\0D  staged-gone.txt\0")).toEqual([
			{ rel: "gone.txt", index: " ", worktree: "D", untracked: false },
			{ rel: "staged-gone.txt", index: "D", worktree: " ", untracked: false },
		]);
	});

	test("skips malformed or empty records", () => {
		expect(parseStatusZ("short\0\0 M ok.txt\0")).toEqual([
			{ rel: "ok.txt", index: " ", worktree: "M", untracked: false },
		]);
	});
});

describe("statusLetter", () => {
	const file = (partial: Partial<ChangedFile>): ChangedFile => ({
		rel: "x",
		index: " ",
		worktree: " ",
		untracked: false,
		...partial,
	});

	test("prefers the index column, falls back to worktree, and marks untracked", () => {
		expect(statusLetter(file({ index: "M" }))).toBe("M");
		expect(statusLetter(file({ worktree: "D" }))).toBe("D");
		expect(statusLetter(file({ index: "M", worktree: "M" }))).toBe("M");
		expect(statusLetter(file({ untracked: true, index: "?", worktree: "?" }))).toBe("?");
	});
});

describe("inMode", () => {
	const file = (partial: Partial<ChangedFile>): ChangedFile => ({
		rel: "x",
		index: " ",
		worktree: " ",
		untracked: false,
		...partial,
	});

	test("filters by the column a mode compares", () => {
		expect(inMode(file({ worktree: "M" }), "worktree")).toBe(true);
		expect(inMode(file({ index: "M" }), "worktree")).toBe(false);
		expect(inMode(file({ index: "M" }), "staged")).toBe(true);
		expect(inMode(file({ worktree: "M" }), "staged")).toBe(false);
		expect(inMode(file({ untracked: true, index: "?", worktree: "?" }), "worktree")).toBe(true);
		expect(inMode(file({ untracked: true, index: "?", worktree: "?" }), "staged")).toBe(false);
		expect(inMode(file({ index: "M" }), "head")).toBe(true);
	});
});
