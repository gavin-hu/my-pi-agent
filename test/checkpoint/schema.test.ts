import { describe, expect, test } from "bun:test";
import { MAX_LABEL, normalizeCall } from "../../extensions/checkpoint/schema.ts";

describe("normalizeCall", () => {
	test("accepts each action", () => {
		for (const action of ["save", "list", "diff", "restore", "clear"] as const) {
			expect(normalizeCall({ action }).action).toBe(action);
		}
	});

	test("rejects an unknown action", () => {
		expect(() => normalizeCall({ action: "rewind" })).toThrow(/action must be one of/);
	});

	test("defaults diff and restore to the newest checkpoint", () => {
		expect(normalizeCall({ action: "diff" }).id).toBe("last");
		expect(normalizeCall({ action: "restore" }).id).toBe("last");
		expect(normalizeCall({ action: "list" }).id).toBeUndefined();
	});

	test("rejects an id that could escape the ref namespace", () => {
		for (const id of ["../evil", "a/b", ".hidden", "has space"]) {
			expect(() => normalizeCall({ action: "restore", id })).toThrow(/id must match/);
		}
		// An empty id is the "last" default, not an escape.
		expect(normalizeCall({ action: "restore", id: "" }).id).toBe("last");
	});

	test("trims and bounds a label", () => {
		expect(normalizeCall({ action: "save", label: "  before refactor  " }).label).toBe("before refactor");
		expect(normalizeCall({ action: "save", label: "   " }).label).toBeUndefined();
		expect(() => normalizeCall({ action: "save", label: "x".repeat(MAX_LABEL + 1) })).toThrow(/label is longer/);
	});

	test("strips control characters from a label", () => {
		expect(normalizeCall({ action: "save", label: "a\u001b[31mb\nc" }).label).toBe("a [31mb c");
	});

	test("carries the all flag", () => {
		expect(normalizeCall({ action: "list", all: true }).all).toBe(true);
		expect(normalizeCall({ action: "list" }).all).toBe(false);
	});
});
