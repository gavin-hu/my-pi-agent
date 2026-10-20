import { describe, expect, test } from "bun:test";
import { buildHunkPatch, parseFilePatch } from "./patch.ts";

const PATCH = [
	"diff --git a/src/a.ts b/src/a.ts",
	"index 1111111..2222222 100644",
	"--- a/src/a.ts",
	"+++ b/src/a.ts",
	"@@ -1,3 +1,3 @@ function one() {",
	" keep",
	"-old one",
	"+new one",
	" keep",
	"@@ -20,3 +20,4 @@ function two() {",
	" keep",
	"-old two",
	"+new two",
	"+extra",
	" tail",
	"\\ No newline at end of file",
].join("\n");

describe("parseFilePatch", () => {
	test("splits the file header from two hunks and counts each body", () => {
		const patch = parseFilePatch(PATCH);

		expect(patch?.header).toEqual([
			"diff --git a/src/a.ts b/src/a.ts",
			"index 1111111..2222222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
		]);
		expect(patch?.hunks.map((hunk) => hunk.header)).toEqual([
			"@@ -1,3 +1,3 @@ function one() {",
			"@@ -20,3 +20,4 @@ function two() {",
		]);
		expect(patch?.hunks.map((hunk) => [hunk.added, hunk.removed])).toEqual([
			[1, 1],
			[2, 1],
		]);
		expect(patch?.hunks[1]?.lines.at(-1)).toBe("\\ No newline at end of file");
	});

	test("keeps a carriage return inside a body line", () => {
		const patch = parseFilePatch(PATCH.replace("+new one", "+new one\r"));

		expect(patch?.hunks[0]?.lines).toContain("+new one\r");
	});

	test("rejects a binary patch, a mode-only change, and a headerless diff", () => {
		expect(parseFilePatch(["diff --git a/x b/x", "Binary files a/x and b/x differ", ""].join("\n"))).toBeUndefined();
		expect(parseFilePatch(["diff --git a/x b/x", "old mode 100644", "new mode 100755", ""].join("\n"))).toBeUndefined();
		expect(parseFilePatch("@@ -1 +1 @@\n-a\n+b\n")).toBeUndefined();
	});

	test("rejects a patch that spans two files", () => {
		const multi = [PATCH, "diff --git a/src/b.ts b/src/b.ts", "--- a/src/b.ts", "+++ b/src/b.ts"].join("\n");

		expect(parseFilePatch(multi)).toBeUndefined();
	});
});

describe("buildHunkPatch", () => {
	test("keeps the header and only the chosen hunks, with a trailing newline", () => {
		const patch = parseFilePatch(PATCH);
		expect(patch).toBeDefined();
		if (!patch) return;

		const built = buildHunkPatch(patch, [1]);

		expect(built.startsWith("diff --git a/src/a.ts b/src/a.ts\n")).toBe(true);
		expect(built).toContain("@@ -20,3 +20,4 @@ function two() {");
		expect(built).not.toContain("@@ -1,3 +1,3 @@");
		expect(built.endsWith("\n")).toBe(true);
	});

	test("dedupes and orders indices, dropping out-of-range ones", () => {
		const patch = parseFilePatch(PATCH);
		expect(patch).toBeDefined();
		if (!patch) return;

		const built = buildHunkPatch(patch, [1, 0, 1, -1, 9]);

		expect(built.indexOf("@@ -1,3 +1,3 @@")).toBeLessThan(built.indexOf("@@ -20,3 +20,4 @@"));
		expect(built.split("@@ -1,3 +1,3 @@")).toHaveLength(2);
		expect(built.split("@@ -20,3 +20,4 @@")).toHaveLength(2);
	});
});
