import { describe, expect, test } from "bun:test";
import { hasPathInput, PATH_KEYS } from "../../extensions/plan/path-guard.ts";

describe("hasPathInput", () => {
	test("detects common path argument names", () => {
		expect(hasPathInput({ path: "a.ts" })).toBe(true);
		expect(hasPathInput({ file_path: "a.ts" })).toBe(true);
		expect(hasPathInput({ filePath: "a.ts" })).toBe(true);
		expect(hasPathInput({ files: ["a.ts", "b.ts"] })).toBe(true);
		expect(hasPathInput({ directory: "/tmp" })).toBe(true);
	});

	test("ignores path keys without string values", () => {
		expect(hasPathInput({ path: 123 })).toBe(false);
		expect(hasPathInput({ paths: [1, 2] })).toBe(false);
		expect(hasPathInput({ path: null })).toBe(false);
	});

	test("ignores inputs without path keys", () => {
		expect(hasPathInput({ query: "x" })).toBe(false);
		expect(hasPathInput({ command: "ls" })).toBe(false);
		expect(hasPathInput({})).toBe(false);
	});

	test("handles non-object input", () => {
		expect(hasPathInput(undefined)).toBe(false);
		expect(hasPathInput(null)).toBe(false);
		expect(hasPathInput("a.ts")).toBe(false);
		expect(hasPathInput(42)).toBe(false);
	});

	test("exposes the recognized keys", () => {
		expect(PATH_KEYS.has("path")).toBe(true);
		expect(PATH_KEYS.has("file_path")).toBe(true);
	});
});
