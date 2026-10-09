import { describe, expect, test } from "bun:test";
import { MAX_ENTRY_CHARS, normalizeAction, normalizeEntryText, normalizeScope } from "./schema.ts";

describe("memory schema", () => {
	test("normalizeAction accepts the known actions and rejects others", () => {
		expect(normalizeAction("add")).toBe("add");
		expect(normalizeAction(" FORGET ")).toBe("forget");
		expect(() => normalizeAction("delete")).toThrow(/action must be/);
	});

	test("normalizeScope defaults to project", () => {
		expect(normalizeScope(undefined)).toBe("project");
		expect(normalizeScope("global")).toBe("global");
		expect(() => normalizeScope("team")).toThrow(/scope must be/);
	});

	test("normalizeEntryText collapses to one line", () => {
		expect(normalizeEntryText("  a\n\tb\t")).toBe("a b");
	});

	test("normalizeEntryText rejects a blank, non-string, or over-long note", () => {
		expect(() => normalizeEntryText("   ")).toThrow(/text is required/);
		expect(() => normalizeEntryText(123)).toThrow(/text is required/);
		expect(() => normalizeEntryText("x".repeat(MAX_ENTRY_CHARS + 1))).toThrow(/longer than/);
	});
});
