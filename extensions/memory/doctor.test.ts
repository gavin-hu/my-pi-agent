/**
 * The `/memory doctor` report: what the two stores hold, what the cap does with them, and
 * which file each row is about.
 *
 * Its own suite because the report is its own module, and because `store.test.ts` sits at
 * its line bar: these are assertions about the text a session reads, not about storage.
 */

import { describe, expect, test } from "bun:test";
import { duplicatePairs, formatHealth, memoryHealth } from "./doctor.ts";
import { notesOf } from "../../test/helpers/fixtures/memory.ts";
import { MAX_STORE_BYTES } from "./store.ts";

const CONFIG = { inject: true, maxInjectBytes: 8192 };
/** Two resolved stores, so a row can be held to the file it names. */
const PATHS = { project: "/repo/.pi/memory.md", global: "/agent/memory.md" };

describe("memory health", () => {
	function health(
		over: {
			project?: string[];
			global?: string[];
			sizes?: { project?: number; global?: number };
			trusted?: boolean;
			config?: typeof CONFIG;
		} = {},
	) {
		return memoryHealth({
			entries: { project: notesOf(over.project ?? []), global: notesOf(over.global ?? []) },
			sizes: { project: over.sizes?.project, global: over.sizes?.global },
			paths: PATHS,
			trusted: over.trusted ?? true,
			config: over.config ?? CONFIG,
		});
	}

	test("counts notes and file bytes per store", () => {
		const result = health({ project: ["a", "b"], global: ["c"], sizes: { project: 412, global: 80 } });
		expect(result.project).toEqual({ notes: 2, bytes: 412, path: PATHS.project });
		expect(result.global).toEqual({ notes: 1, bytes: 80, path: PATHS.global });
	});

	test("reports the injected bytes and that everything fits", () => {
		const result = health({ project: ["a"], sizes: { project: 9 } });
		expect(result.injection?.bytes).toBeGreaterThan(0);
		expect(result.injection?.omitted).toEqual({ project: 0, global: 0 });
	});

	test("names the store that overflowed the cap", () => {
		const notes = Array.from({ length: 40 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const result = health({ global: notes, config: { inject: true, maxInjectBytes: 512 } });
		expect(result.injection?.omitted.global).toBeGreaterThan(0);
		expect(result.injection?.omitted.project).toBe(0);
	});

	test("omits the injection figures when recall is off", () => {
		const result = health({ project: ["a"], config: { inject: false, maxInjectBytes: 8192 } });
		expect(result.injection).toBeUndefined();
	});

	test("keeps duplicate detection inside one scope", () => {
		const result = health({ project: ["Use bun"], global: ["use bun."] });
		expect(result.duplicates).toEqual([]);
	});

	test("pairs notes the conservative key already treats as one fact", () => {
		expect(duplicatePairs({ project: notesOf(["Use bun", "other", "use bun."]), global: [] })).toEqual([
			{ scope: "project", kept: "Use bun", duplicate: "use bun." },
		]);
	});

	test("keeps paraphrases apart", () => {
		// The key never folds word order or internal punctuation.
		expect(duplicatePairs({ project: notesOf(["Run unit tests with bun", "Use bun for tests"]), global: [] })).toEqual(
			[],
		);
	});

	test("prints counts, bytes, the budget, and that the store is clean", () => {
		const text = formatHealth(health({ project: ["a", "b"], sizes: { project: 412, global: 80 } }));
		expect(text.split("\n")[0]).toBe("Memory health");
		expect(text).toMatch(/project\s+2 notes · 412 B/);
		expect(text).toMatch(/global\s+0 notes · 80 B/);
		expect(text).toMatch(/injection +\d+ B of 8192 B · all notes fit/);
		expect(text).toContain("duplicates none");
	});

	test("names the file each row read, so an empty store says which one", () => {
		const text = formatHealth(health({}));
		expect(text).toContain(`0 notes · ${PATHS.project}`);
		expect(text).toContain(`0 notes · ${PATHS.global}`);
	});

	test("names a store past the write ceiling, with the number and the file", () => {
		const text = formatHealth(health({ project: ["a"], sizes: { project: MAX_STORE_BYTES + 1 } }));

		// The session's next decision is what to prune, so the row carries the cap it broke.
		expect(text).toContain(`past the ${MAX_STORE_BYTES}-byte cap`);
		expect(text).toContain(PATHS.project);
	});

	test("prints the authors, most first and the unattributed last", () => {
		const stamped = memoryHealth({
			entries: {
				project: [
					{ text: "a", by: "gavin", at: "2026-11-18T05:00:00.000Z" },
					{ text: "b", by: "gavin", at: "2026-11-18T05:01:00.000Z" },
					{ text: "c", by: "jack", at: "2026-11-18T05:02:00.000Z" },
					{ text: "d" },
				],
				global: [],
			},
			sizes: { project: undefined, global: undefined },
			paths: PATHS,
			trusted: true,
			config: CONFIG,
		});

		// The row a session reads, not just the field behind it.
		expect(formatHealth(stamped)).toMatch(/authors\s+gavin 2 \u00b7 jack 1 \u00b7 unattributed 1/);
	});

	test("leaves a store under the ceiling unmarked", () => {
		expect(formatHealth(health({ project: ["a"], sizes: { project: MAX_STORE_BYTES } }))).not.toContain("cap");
	});

	test("names the omitted notes and the scope they came from", () => {
		const notes = Array.from({ length: 40 }, (_, index) => `note ${index} ${"x".repeat(40)}`);
		const text = formatHealth(health({ global: notes, config: { inject: true, maxInjectBytes: 512 } }));
		expect(text).toMatch(/injection +\d+ B of 512 B · \d+ omitted \(global \d+\)/);
	});

	test("says when recall is off and when the project store is unreadable", () => {
		const off = formatHealth(health({ config: { inject: false, maxInjectBytes: 8192 } }));
		expect(off).toContain("off (memory.inject is false)");
		const untrusted = formatHealth(health({ trusted: false, global: ["a"], sizes: { global: 20 } }));
		expect(untrusted).toMatch(/project\s+unavailable \(untrusted project\)/);
		expect(untrusted).toMatch(/global\s+1 note · 20 B/);
	});

	test("lists each duplicate pair and points at the merge", () => {
		const text = formatHealth(health({ project: ["Use bun", "use bun."], sizes: { project: 40 } }));
		expect(text).toContain("duplicates 1 pair (merge with m in /memory)");
		expect(text).toContain('project  "Use bun" ≈ "use bun."');
	});
});
