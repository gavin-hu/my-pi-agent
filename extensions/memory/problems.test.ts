/**
 * The notes a write through the tool could not have produced: what the read path
 * names, and what it deliberately leaves to the authors row.
 *
 * Its own suite because `store.test.ts` sits at its line bar, and because these are
 * assertions about a diagnostic rather than about storage.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { MAX_ENTRY_CHARS } from "./schema.ts";
import { noteProblems, parseNoteLines } from "./store.ts";

describe("note problems", () => {
	test("keeps the line each note came from", () => {
		const content = ["# Notes", "some prose", "- first", "", "- second"].join("\n");
		expect(parseNoteLines(content)).toEqual([
			{ line: 3, note: { text: "first" } },
			{ line: 5, note: { text: "second" } },
		]);
	});

	test("reports a note past the cap with its line and length, never counting its trailer", () => {
		const over = "x".repeat(1539);
		const atCap = "y".repeat(MAX_ENTRY_CHARS);
		const content = ["- short", `- ${over} <!-- by: tom @ 2026-11-23T00:00:00.000Z -->`, `- ${atCap}`].join("\n");
		const problems = noteProblems(parseNoteLines(content), MAX_ENTRY_CHARS);
		expect(problems.map((problem) => [problem.line, problem.length])).toEqual([[2, 1539]]);
	});

	test("a note with no trailer is not a problem", () => {
		const content = "- hand written, with no trailer at all";
		expect(noteProblems(parseNoteLines(content), MAX_ENTRY_CHARS)).toEqual([]);
	});
});

describe("a load that names a problem", () => {
	let suite: MemorySuite;
	let runtime: MemoryRuntime;

	beforeEach(async () => {
		suite = memorySuite();
		await suite.start();
		runtime = createMemoryRuntime(suite.pi);
		await runtime.load(suite.cwd, true);
	});

	afterEach(() => {
		suite.dispose();
	});

	test("names an over-cap note by line and length, and still reads it", async () => {
		suite.write("project", `- ${"x".repeat(1539)}\n`);

		const warning = await runtime.load(suite.cwd, true);

		expect(warning).toBe("project line 1 is 1,539 characters; the limit is 500 \u2014 /memory edit or /memory forget");
		// Reports, never refuses: the note is what a session reads, and it can still be forgotten.
		expect(runtime.entries().project.map((note) => note.text.length)).toEqual([1539]);
		expect(runtime.problems().project.map((problem) => [problem.line, problem.length])).toEqual([[1, 1539]]);
	});

	test("a clean store warns about nothing and names no problem", async () => {
		suite.write("project", "- short note\n");

		expect(await runtime.load(suite.cwd, true)).toBeUndefined();
		expect(runtime.problems()).toEqual({ project: [], global: [] });
	});

	test("a note with no trailer is not a problem", async () => {
		suite.write("project", "- written by hand, with no trailer at all\n");

		expect(await runtime.load(suite.cwd, true)).toBeUndefined();
		expect(runtime.problems().project).toEqual([]);
	});

	test("fixing the note through the tool clears the problem", async () => {
		suite.write("project", `- ${"x".repeat(1539)}\n`);
		await runtime.load(suite.cwd, true);

		await runtime.write("project", "- short note\n");

		expect(runtime.problems().project).toEqual([]);
	});
});
