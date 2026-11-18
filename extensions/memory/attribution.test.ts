/**
 * Who a note says wrote it, and when — and what a note is still matched by.
 *
 * The trailer on the bullet is metadata: the **text** stays the note's identity, so
 * `forget` and `update` match what a reader reads, and a note from before attribution
 * reads as unattributed with no migration.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { DEFAULT_MEMORY_CONFIG } from "./config.ts";
import { memoryHealth } from "./doctor.ts";
import { buildInjection } from "./format.ts";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { applyAdd, applyForget, applyUpdate, parseNotes } from "./store.ts";

const STAMP = { by: "jack", at: "2026-11-18T05:12:00.000Z" };
const LATER = { by: "gavin", at: "2026-11-18T06:30:00.000Z" };

let suite: MemorySuite;
let runtime: MemoryRuntime;

beforeEach(() => {
	suite = memorySuite();
	runtime = createMemoryRuntime(suite.pi, { now: () => Date.parse(STAMP.at) });
});

afterEach(() => {
	runtime.reset();
	suite.dispose();
});

describe("a note's trailer", () => {
	test("is written as a comment at the end of the bullet, and read back", () => {
		const result = applyAdd("", "the store keeps the newest notes", STAMP);

		expect(result.content).toContain("- the store keeps the newest notes <!-- by: jack @ 2026-11-18T05:12:00.000Z -->");
		expect(parseNotes(result.content)).toEqual([
			{ text: "the store keeps the newest notes", by: "jack", at: STAMP.at },
		]);
	});

	test("is optional: a note without one reads unattributed, and renders bare", () => {
		expect(parseNotes("- written by hand\n")).toEqual([{ text: "written by hand" }]);
	});

	test("does not join the note's identity, so forget takes the text a reader read", () => {
		const stored = applyAdd("", "use bun", STAMP).content;

		expect(applyForget(stored, "use bun").changed).toBe(true);
		// And the label a list showed is accepted too, since that is the string a model reads.
		expect(applyForget(stored, "[jack] use bun").changed).toBe(true);
		expect(applyForget(stored, "use bun <!-- by: jack @ 2026-11-18T05:12:00.000Z -->").changed).toBe(false);
	});

	test("is refreshed by an update, which is the session asserting the corrected note", () => {
		const stored = applyAdd("", "use tabs", STAMP).content;

		const updated = applyUpdate(stored, "use tabs", "use spaces", LATER);

		expect(parseNotes(updated.content)).toEqual([{ text: "use spaces", by: "gavin", at: LATER.at }]);
	});

	test("is not read out of a note that merely holds a comment opener", () => {
		// The parse is anchored to the end of the line and needs the label form, so a note
		// about markdown stays a note.
		const notes = parseNotes(
			"- a note with <!-- an html comment --> inside\n- one that ends with <!-- not a trailer -->\n",
		);

		expect(notes).toEqual([
			{ text: "a note with <!-- an html comment --> inside" },
			{ text: "one that ends with <!-- not a trailer -->" },
		]);
	});

	test("is not written by a read", () => {
		suite.write("project", "- plain\n- [not a label] text <!-- by: jack @ 2026-11-18T05:12:00.000Z -->\n");
		const before = readFileSync(suite.projectPath, "utf-8");

		expect(parseNotes(before).length).toBe(2);
		expect(readFileSync(suite.projectPath, "utf-8")).toBe(before);
	});
});

describe("a session's label", () => {
	test("is what its writes are stamped with, under the injected clock", async () => {
		runtime.setActor("jack");
		await runtime.load(suite.cwd, true);

		await runtime.add("project", "learned in this session");

		expect(suite.read("project")).toContain("<!-- by: jack @ 2026-11-18T05:12:00.000Z -->");
		expect(runtime.entries().project).toEqual([{ text: "learned in this session", by: "jack", at: STAMP.at }]);
	});

	test("stamps nothing when nothing resolved it, rather than inventing a name", async () => {
		runtime.setActor(Promise.resolve(undefined));
		await runtime.load(suite.cwd, true);

		await runtime.add("project", "nobody is named on this");

		expect(suite.read("project")).toContain("- nobody is named on this\n");
		expect(suite.read("project")).not.toContain("nobody is named on this <!--");
	});

	test("survives a promise that rejects, writing an unattributed note", async () => {
		runtime.setActor(Promise.reject(new Error("no bus here")).catch(() => undefined));
		await runtime.load(suite.cwd, true);

		await runtime.add("project", "still a note");

		expect(runtime.entries().project).toEqual([{ text: "still a note" }]);
	});

	test("is what the injected body names, so a peer's assertion is visible", async () => {
		suite.write("project", "- [jack] a worktree shares its checkout's store\n- an old note\n");

		const injected = buildInjection({ project: parseNotes(suite.read("project")), global: [] }, 8192);

		expect(injected).toContain("- [jack] a worktree shares its checkout's store");
		expect(injected).toContain("- an old note");
	});

	test("is what the doctor counts, most first and the unattributed last", async () => {
		suite.write(
			"project",
			[
				"- first <!-- by: gavin @ 2026-11-18T05:00:00.000Z -->",
				"- second <!-- by: gavin @ 2026-11-18T05:01:00.000Z -->",
				"- third <!-- by: jack @ 2026-11-18T05:02:00.000Z -->",
				"- by hand",
				"",
			].join("\n"),
		);
		await runtime.load(suite.cwd, true);
		const paths = runtime.paths();
		if (!paths) throw new Error("the session did not resolve its stores");

		const health = memoryHealth({
			entries: runtime.entries(),
			sizes: runtime.sizes(),
			paths,
			trusted: true,
			config: DEFAULT_MEMORY_CONFIG,
		});

		expect(health.authors).toEqual([
			{ by: "gavin", notes: 2 },
			{ by: "jack", notes: 1 },
			{ by: "unattributed", notes: 1 },
		]);
	});
});
