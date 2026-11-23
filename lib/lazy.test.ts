/**
 * The lazy seam: one load, shared by concurrent callers, and a failure that can
 * be retried — plus the guard that reads a module's deferrals back against the
 * tree it is sitting in.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertDeferredPresent, deferredSpecifiers, lazy } from "./lazy.ts";

describe("lazy", () => {
	test("loads once for concurrent and later callers", async () => {
		let loads = 0;
		const value = lazy(async () => {
			loads += 1;
			await Promise.resolve();
			return { id: loads };
		});
		const [first, second] = await Promise.all([value.get(), value.get()]);
		const third = await value.get();
		expect(loads).toBe(1);
		expect(first).toBe(second);
		expect(third).toBe(first);
	});

	test("peek answers undefined until the value is loaded", async () => {
		const value = lazy(async () => "loaded");
		expect(value.peek()).toBeUndefined();
		await value.get();
		expect(value.peek()).toBe("loaded");
	});

	test("a rejected load is forgotten, so the next call retries", async () => {
		let attempts = 0;
		const value = lazy(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("first attempt failed");
			return "loaded";
		});
		await expect(value.get()).rejects.toThrow("first attempt failed");
		expect(value.peek()).toBeUndefined();
		expect(await value.get()).toBe("loaded");
		expect(attempts).toBe(2);
	});
});

describe("deferred modules", () => {
	let dir = "";
	let base = "";

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-lazy-"));
		base = pathToFileURL(join(dir, "entry.ts")).href;
		writeFileSync(join(dir, "here.ts"), "export const here = true;\n");
		writeFileSync(join(dir, "entry.ts"), 'await import("./here.ts");\n');
		writeFileSync(join(dir, "gone.ts"), 'await import("./missing.ts");\n');
		writeFileSync(join(dir, "twice.ts"), 'await import("./missing.ts");\nawait import("../elsewhere.ts");\n');
		writeFileSync(join(dir, "built.ts"), 'const specifier = "./missing.ts";\nawait import(specifier);\n');
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("reads a written specifier and skips one built from a variable", () => {
		expect(deferredSpecifiers('await import("./a.ts");\nawait import("../b.ts");')).toEqual(["./a.ts", "../b.ts"]);
		expect(deferredSpecifiers('const name = "./a.ts";\nawait import(name);')).toEqual([]);
		expect(deferredSpecifiers('await import("only-a-package");')).toEqual([]);
	});

	test("is silent when every deferred module is where the source says", () => {
		expect(() => assertDeferredPresent(base, ["entry.ts", "here.ts"])).not.toThrow();
	});

	test("names the file and the specifier it cannot find", () => {
		expect(() => assertDeferredPresent(base, ["gone.ts"])).toThrow(
			/deferred module missing: gone\.ts names \.\/missing\.ts\n {2}absent from .*pi-lazy-/,
		);
		expect(() => assertDeferredPresent(base, ["gone.ts"])).toThrow(/\/reload, or start a new session/);
	});

	test("reports every miss, including one in another file", () => {
		let message = "";
		try {
			assertDeferredPresent(base, ["gone.ts", "twice.ts"]);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("gone.ts names ./missing.ts");
		expect(message).toContain("twice.ts names ../elsewhere.ts");
	});

	test("does not guess at a specifier its source never wrote", () => {
		expect(() => assertDeferredPresent(base, ["built.ts"])).not.toThrow();
	});
});
