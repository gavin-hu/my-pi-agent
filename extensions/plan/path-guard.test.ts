import { describe, expect, test } from "bun:test";
import { hasPathInput, PATH_KEYS } from "./path-guard.ts";

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

	test("finds path keys nested in objects and arrays", () => {
		expect(hasPathInput({ options: { cwd: "/repo" } })).toBe(true);
		expect(hasPathInput({ tasks: [{ task: "x", cwd: "/repo" }] })).toBe(true);
		expect(hasPathInput({ args: { nested: { file_path: "a.ts" } } })).toBe(true);
	});

	test("recognizes path-key words in compound names", () => {
		expect(hasPathInput({ cwd: "/repo" })).toBe(true);
		expect(hasPathInput({ root: "/repo" })).toBe(true);
		expect(hasPathInput({ outputDir: "/repo/out" })).toBe(true);
		expect(hasPathInput({ source_files: ["a.ts"] })).toBe(true);
		expect(hasPathInput({ include: ["**/*.ts"] })).toBe(true);
		expect(hasPathInput({ glob: "**/*.ts" })).toBe(true);
	});

	test("flags strongly path-shaped values under neutral keys", () => {
		expect(hasPathInput({ whatever: "/etc/passwd" })).toBe(true);
		expect(hasPathInput({ whatever: "../secrets" })).toBe(true);
		expect(hasPathInput({ whatever: "src/index.ts" })).toBe(true);
		expect(hasPathInput({ whatever: "C:\\Users\\me" })).toBe(true);
		expect(hasPathInput({ whatever: "~/notes.md" })).toBe(true);
	});

	test("does not flag URLs, lone slash tokens, or plain words", () => {
		expect(hasPathInput({ url: "https://example.com/a/b" })).toBe(false);
		expect(hasPathInput({ label: "/plan" })).toBe(false);
		expect(hasPathInput({ query: "rate limiting" })).toBe(false);
		expect(hasPathInput({ command: "ls" })).toBe(false);
	});
});
