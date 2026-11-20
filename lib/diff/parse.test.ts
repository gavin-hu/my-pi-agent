/**
 * The unified-diff parse: roles, numbering, and the edges git actually emits.
 *
 * Every case here moved with the body from the browse suite, unchanged.
 */

import { describe, expect, test } from "bun:test";
import { type DiffLine, parseUnifiedDiff } from "./parse.ts";

function kinds(lines: DiffLine[]): string[] {
	return lines.map((line) => line.kind);
}

describe("diff parsing", () => {
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
		const parsed = parseUnifiedDiff(["@@ -1,2 +1,2 @@", "--- keep", "+++ add", "-old", "+new"].join("\n"), 100);
		expect(parsed.lines.map((line) => [line.kind, line.text])).toEqual([
			["hunk", "@@ -1,2 +1,2 @@"],
			["del", "-- keep"],
			["add", "++ add"],
			["del", "old"],
			["add", "new"],
		]);
	});

	test("marks a no-newline note", () => {
		const parsed = parseUnifiedDiff(["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file", ""].join("\n"), 100);
		expect(parsed.lines.at(-1)).toMatchObject({ kind: "note", text: "\\ No newline at end of file" });
	});

	test("starts a new file block after a hunk", () => {
		const parsed = parseUnifiedDiff(
			["@@ -1 +1 @@", "-a", "+b", "diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -5 +5 @@", "-c", "+d"].join("\n"),
			100,
		);
		expect(kinds(parsed.lines)).toEqual(["hunk", "del", "add", "meta", "meta", "meta", "hunk", "del", "add"]);
		expect(parsed.lines[6]).toMatchObject({ kind: "hunk", text: "@@ -5 +5 @@" });
		expect(parsed.lines[7]).toMatchObject({ oldNo: 5 });
	});

	test("detects both binary markers", () => {
		expect(parseUnifiedDiff("diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n", 100).binary).toBe(
			true,
		);
		expect(parseUnifiedDiff("diff --git a/a.png b/a.png\nGIT binary patch\n", 100).binary).toBe(true);
	});

	test("strips CRLF and drops the trailing newline", () => {
		const parsed = parseUnifiedDiff("@@ -1 +1 @@\r\n-a\r\n+b\r\n", 100);
		expect(parsed.lines.map((line) => line.text)).toEqual(["@@ -1 +1 @@", "a", "b"]);
	});

	test("truncates at maxLines and flags it", () => {
		const parsed = parseUnifiedDiff(["@@ -1,3 +1,3 @@", "-a", "+b", " c", " d"].join("\n"), 3);
		expect(parsed.truncated).toBe(true);
		expect(parsed.lines).toHaveLength(3);
	});

	test("returns nothing for empty input", () => {
		expect(parseUnifiedDiff("", 100)).toEqual({ lines: [], truncated: false, binary: false });
	});
});
