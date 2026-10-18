import { describe, expect, test } from "bun:test";
import type { MemoryConfig } from "./config.ts";
import { duplicatePairs, formatHealth, memoryHealth } from "./doctor.ts";

const CONFIG: MemoryConfig = { inject: true, maxInjectBytes: 8192 };

function health(
	over: {
		project?: string[];
		global?: string[];
		sizes?: { project?: number; global?: number };
		trusted?: boolean;
		config?: MemoryConfig;
	} = {},
) {
	return memoryHealth({
		entries: { project: over.project ?? [], global: over.global ?? [] },
		sizes: { project: over.sizes?.project, global: over.sizes?.global },
		trusted: over.trusted ?? true,
		config: over.config ?? CONFIG,
	});
}

describe("memoryHealth", () => {
	test("counts notes and file bytes per store", () => {
		const result = health({ project: ["a", "b"], global: ["c"], sizes: { project: 412, global: 80 } });
		expect(result.project).toEqual({ notes: 2, bytes: 412 });
		expect(result.global).toEqual({ notes: 1, bytes: 80 });
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
});

describe("duplicatePairs", () => {
	test("pairs notes the conservative key already treats as one fact", () => {
		expect(duplicatePairs({ project: ["Use bun", "other", "use bun."], global: [] })).toEqual([
			{ scope: "project", kept: "Use bun", duplicate: "use bun." },
		]);
	});

	test("keeps paraphrases apart", () => {
		// The key never folds word order or internal punctuation.
		expect(duplicatePairs({ project: ["Run unit tests with bun", "Use bun for tests"], global: [] })).toEqual([]);
	});
});

describe("formatHealth", () => {
	test("prints counts, bytes, the budget, and that the store is clean", () => {
		const text = formatHealth(health({ project: ["a", "b"], sizes: { project: 412, global: 80 } }));
		expect(text.split("\n")[0]).toBe("Memory health");
		expect(text).toMatch(/project\s+2 notes · 412 B/);
		expect(text).toMatch(/global\s+0 notes · 80 B/);
		expect(text).toMatch(/injection +\d+ B of 8192 B · all notes fit/);
		expect(text).toContain("duplicates none");
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
