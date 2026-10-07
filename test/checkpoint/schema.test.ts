import { describe, expect, test } from "bun:test";
import { MAX_LABEL, normalizeSave } from "../../extensions/checkpoint/schema.ts";

describe("normalizeSave", () => {
	test("trims and bounds a label", () => {
		expect(normalizeSave({ label: "  before refactor  " }).label).toBe("before refactor");
		expect(normalizeSave({ label: "   " }).label).toBeUndefined();
		expect(normalizeSave({}).label).toBeUndefined();
		expect(() => normalizeSave({ label: "x".repeat(MAX_LABEL + 1) })).toThrow(/label is longer/);
	});

	test("strips control characters from a label", () => {
		expect(normalizeSave({ label: "a\u001b[31mb\nc" }).label).toBe("a [31mb c");
	});

	test("ignores arguments from the old action-based schema", () => {
		expect(normalizeSave({ action: "restore", id: "last" }).label).toBeUndefined();
	});
});
