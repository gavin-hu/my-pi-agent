/**
 * The `merge` verb through the tool: what the picker could already do, and what a session that
 * sees only part of a store needs in order to consolidate the notes it can see.
 *
 * Its own suite because `tools.test.ts` is at the bar; the verb's answers — a pair folded, a pair
 * with a name missing, one note named twice, a field refused by name — are one capability.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { overLimit } from "../../lib/format.ts";
import { memoryCall, memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { MAX_ENTRY_CHARS } from "./schema.ts";

let suite: MemorySuite;

beforeEach(() => {
	suite = memorySuite();
});

afterEach(() => {
	suite.dispose();
});

describe("memory tool merge", () => {
	test("merges two notes into one through the tool", async () => {
		suite.write("project", "- Use bun\n- Use bun for tests\n");
		await suite.start();

		const merged = await memoryCall(suite, {
			action: "merge",
			first: "Use bun",
			second: "Use bun for tests",
			merged: "Use bun for every test",
		});

		expect(merged.details.changed).toBe(true);
		expect(merged.details.project.some((note: string) => note.endsWith("Use bun for every test"))).toBe(true);
		expect(suite.read("project")).toContain("- Use bun for every test");
		expect(suite.read("project")).not.toContain("- Use bun for tests");
	});

	test("a merge whose pair is not both there is refused, naming both", async () => {
		suite.write("project", "- Use bun\n");
		await suite.start();
		const before = suite.read("project");

		const refused = await memoryCall(suite, { action: "merge", first: "Use bun", second: "gone", merged: "whatever" });

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain('match both "Use bun" and "gone"');
		expect(suite.read("project")).toBe(before);
	});

	test("a merge of one note with itself is refused before the store is asked", async () => {
		suite.write("project", "- Use bun\n");
		await suite.start();
		const before = suite.read("project");

		const refused = await memoryCall(suite, {
			action: "merge",
			first: "Use bun",
			second: "Use bun",
			merged: "changed",
		});

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("was named twice");
		expect(suite.read("project")).toBe(before);
	});

	test("a merge names an over-cap note by its exact text", async () => {
		const long = "x".repeat(MAX_ENTRY_CHARS + 100);
		suite.write("project", `- ${long}\n- Use bun\n`);
		await suite.start();

		const merged = await memoryCall(suite, {
			action: "merge",
			first: long,
			second: "Use bun",
			merged: "Use bun for tests",
		});

		expect(merged.details.changed).toBe(true);
		expect(suite.read("project")).toContain("- Use bun for tests");
	});

	test("a merge still caps the note it writes", async () => {
		suite.write("project", "- Use bun\n- Use bun for tests\n");
		await suite.start();
		const before = suite.read("project");

		const refused = await memoryCall(suite, {
			action: "merge",
			first: "Use bun",
			second: "Use bun for tests",
			merged: "x".repeat(MAX_ENTRY_CHARS + 1),
		});

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain(overLimit("merged", MAX_ENTRY_CHARS + 1, MAX_ENTRY_CHARS));
		expect(suite.read("project")).toBe(before);
	});

	test("a merge names the field it was refused for", async () => {
		suite.write("project", "- Use bun\n");
		await suite.start();

		const refused = await memoryCall(suite, { action: "merge", first: "Use bun", second: "other", merged: "   " });

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("merged is required");
	});
});
