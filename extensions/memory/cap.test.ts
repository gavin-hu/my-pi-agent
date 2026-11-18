/**
 * The two ceilings a store has: what Pi will write it up to, and what it will read at all.
 *
 * They are different numbers on purpose. The write ceiling is a policy about a small store,
 * checked on the transform's result so growth past it never lands and a shrink always does;
 * the read ceiling is an out-of-memory guard, so a store that grew outside Pi — pasted in,
 * hand-edited, restored — can still be listed, edited, pruned and cleared from inside Pi.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { MAX_READ_BYTES, MAX_STORE_BYTES, readMemoryFile } from "./store.ts";

/** A store of about `size` bytes: distinct notes, each `width` characters of text. */
function storeOfSize(size: number, width = 200): string {
	const lines: string[] = [];
	let used = 0;
	for (let index = 0; used < size; index += 1) {
		const line = `- note ${index} ${`x`.repeat(width)}`;
		lines.push(line);
		used += Buffer.byteLength(line, "utf-8") + 1;
	}
	return `${lines.join("\n")}\n`;
}

/** Notes enough to push a store past the write ceiling. */
const OVER_CAP = storeOfSize(MAX_STORE_BYTES + 40_000);

/** A store just under the write ceiling, so one more note crosses it. */
const NEAR_CAP = storeOfSize(MAX_STORE_BYTES - 300);

let suite: MemorySuite;
let runtime: MemoryRuntime;

beforeEach(async () => {
	suite = memorySuite();
	runtime = createMemoryRuntime(suite.pi);
});

afterEach(() => {
	runtime.reset();
	suite.dispose();
});

describe("the write ceiling", () => {
	test("refuses a note that would cross it, and leaves the store byte-identical", async () => {
		suite.write("project", NEAR_CAP);
		await runtime.load(suite.cwd, true);
		const before = statSync(suite.projectPath).size;

		await expect(runtime.add("project", "y".repeat(400))).rejects.toThrow(/past the \d+-byte cap/);

		// The refusal wrote nothing: a message-only case would pass with a half-applied store.
		expect(statSync(suite.projectPath).size).toBe(before);
		expect(suite.read("project")).toBe(NEAR_CAP);
	});

	test("names the file and both sizes, since what to prune is the next decision", async () => {
		suite.write("project", NEAR_CAP);
		await runtime.load(suite.cwd, true);

		const failure = runtime.add("project", "y".repeat(400));
		await expect(failure).rejects.toThrow(new RegExp(`${MAX_STORE_BYTES}-byte cap: .*memory\\.md`));
	});

	test("refuses a growing write and lands a shrinking one", async () => {
		suite.write("project", OVER_CAP);
		await runtime.load(suite.cwd, true);

		await expect(runtime.write("project", `${OVER_CAP}- one more note\n`)).rejects.toThrow(/past the \d+-byte cap/);
		await runtime.write("project", "- only this\n");

		expect(suite.read("project")).toBe("- only this\n");
	});
});

describe("a store over the ceiling", () => {
	test("is readable, which is how one that grew outside Pi comes back", async () => {
		suite.write("project", OVER_CAP);

		const warning = await runtime.load(suite.cwd, true);

		expect(warning).toBeUndefined();
		expect(runtime.entries().project.length).toBeGreaterThan(0);
	});

	test("is peeled down by a forget, which always lands", async () => {
		suite.write("project", OVER_CAP);
		await runtime.load(suite.cwd, true);
		const before = statSync(suite.projectPath).size;
		const [first] = runtime.entries().project;
		if (!first) throw new Error("the store should hold notes");

		expect(await runtime.forget("project", first)).toBe(true);

		expect(statSync(suite.projectPath).size).toBeLessThan(before);
		expect(suite.read("project")).not.toContain(first);
	});

	test("is emptied by a clear, which always lands", async () => {
		suite.write("project", OVER_CAP);
		await runtime.load(suite.cwd, true);

		expect(await runtime.clear("project")).toBe(true);

		expect(runtime.entries().project).toEqual([]);
	});
});

describe("the read ceiling", () => {
	test("refuses a file past it, naming the path and who could have written one", async () => {
		writeFileSync(suite.projectPath, "a".repeat(MAX_READ_BYTES + 1));

		expect(() => readMemoryFile(suite.projectPath)).toThrow(/larger than the .*Pi does not write a file this large/);
	});

	test("lets the write ceiling be the one a session meets", async () => {
		// A store between the two ceilings is the state this pair exists for: readable, and
		// refusing to grow.

		expect(MAX_STORE_BYTES).toBeLessThan(MAX_READ_BYTES);
		expect(OVER_CAP.length).toBeLessThan(MAX_READ_BYTES);
	});
});
