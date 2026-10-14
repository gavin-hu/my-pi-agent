import { describe, expect, test } from "bun:test";
import { MAX_LABEL, normalizeCall } from "./schema.ts";

describe("normalizeCall", () => {
	test("rejects an unknown action", () => {
		expect(() => normalizeCall({ action: "bogus" })).toThrow(/action must be one of/);
	});

	test("add takes a file path and trims it", () => {
		expect(normalizeCall({ action: "add", path: "  app.log  ", pattern: " error " })).toEqual({
			action: "add",
			path: "app.log",
			pattern: "error",
		});
	});

	test("add takes a command", () => {
		expect(normalizeCall({ action: "add", command: "tail -f x", pattern: "x", exclude: ["a", "b"] })).toEqual({
			action: "add",
			command: "tail -f x",
			pattern: "x",
			exclude: ["a", "b"],
		});
	});

	test("add requires exactly one source", () => {
		expect(() => normalizeCall({ action: "add", pattern: "x" })).toThrow(/requires a path or a command/);
		expect(() => normalizeCall({ action: "add", path: "a", command: "b", pattern: "x" })).toThrow(
			/either a path or a command/,
		);
	});

	test("add requires a compilable pattern", () => {
		expect(() => normalizeCall({ action: "add", path: "a" })).toThrow(/requires a pattern/);
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "(" })).toThrow(/not a valid regular expression/);
	});

	test("add rejects an invalid exclude pattern", () => {
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "x", exclude: ["["] })).toThrow(
			/exclude is not a valid regular expression/,
		);
	});

	test("add rejects an oversized label", () => {
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "x", label: "z".repeat(MAX_LABEL + 1) })).toThrow(
			/label is longer/,
		);
	});

	test("id actions require an id", () => {
		for (const action of ["status", "matches", "logs", "stop"]) {
			expect(() => normalizeCall({ action })).toThrow(/requires an id/);
		}
	});

	test("matches and logs bound their line count", () => {
		expect(() => normalizeCall({ action: "matches", id: "w1", lines: 0 })).toThrow(/lines must be between/);
		expect(normalizeCall({ action: "logs", id: "w1", lines: 10 })).toEqual({ action: "logs", id: "w1", lines: 10 });
	});

	test("clear accepts an optional id and all flag", () => {
		expect(normalizeCall({ action: "clear" })).toEqual({ action: "clear" });
		expect(normalizeCall({ action: "clear", all: true })).toEqual({ action: "clear", all: true });
	});
});
