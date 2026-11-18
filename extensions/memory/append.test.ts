/**
 * An add publishes by appending, so two sessions writing one store never lose each other's line.
 *
 * The property is proved where it is deterministic: an add leaves the store's **inode**
 * unchanged — no temp, no rename — while an `update` and a `forget` change it. A two-process
 * race would be timing-dependent; the rename-free write is the thing that removes the loss.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { createMemoryRuntime, type MemoryRuntime } from "./runtime.ts";
import { MAX_STORE_BYTES, appendMemoryNote, readMemoryFile } from "./store.ts";

const STAMP = { by: "jack", at: "2026-11-18T05:12:00.000Z" };
/** Windows reports one inode for every file, so the contrast is a POSIX assertion. */
const POSIX = process.platform !== "win32";

let suite: MemorySuite;
let runtime: MemoryRuntime;

beforeEach(async () => {
	suite = memorySuite();
	runtime = createMemoryRuntime(suite.pi, { now: () => Date.parse(STAMP.at) });
	runtime.setActor("jack");
	await runtime.load(suite.cwd, true);
});

afterEach(() => {
	runtime.reset();
	suite.dispose();
});

describe("an append", () => {
	test.skipIf(!POSIX)("publishes without a rename, where a rewrite does rename", async () => {
		await runtime.add("project", "first");
		const appended = statSync(suite.projectPath).ino;

		await runtime.add("project", "second");

		// A temp-and-rename would publish a new inode; an append cannot.
		expect(statSync(suite.projectPath).ino).toBe(appended);
		expect(suite.read("project")).toContain("- second");

		await runtime.update("project", "second", "third");
		const rewritten = statSync(suite.projectPath).ino;
		expect(rewritten).not.toBe(appended);

		await runtime.forget("project", "third");
		expect(statSync(suite.projectPath).ino).not.toBe(rewritten);
	});

	test("gives an empty store its header and the note in one write", async () => {
		await runtime.add("project", "the first note ever");

		const text = suite.read("project");
		expect(text.startsWith("<!-- Pi memory:")).toBe(true);
		expect(text.endsWith("- the first note ever <!-- by: jack @ 2026-11-18T05:12:00.000Z -->\n")).toBe(true);
	});

	test("puts the note on its own line when the store has no trailing newline", async () => {
		suite.write("project", "- a note written by hand");

		await runtime.add("project", "and one from a session");

		expect(suite.read("project")).toBe(
			`- a note written by hand\n- and one from a session <!-- by: jack @ 2026-11-18T05:12:00.000Z -->\n`,
		);
	});

	test("leaves the blank lines a store already carried, which only a rewrite tidies", async () => {
		suite.write("project", "- a note\n\n\n");

		await runtime.add("project", "after the blanks");

		// The append cannot remove bytes; the next rewrite collapses them.
		expect(suite.read("project")).toBe(
			`- a note\n\n\n- after the blanks <!-- by: jack @ 2026-11-18T05:12:00.000Z -->\n`,
		);
	});

	test("refuses on the bytes that would land, past the cap", async () => {
		// Trailing blanks make the landed text larger than the rewrite's collapsed result.
		const filler = `- ${"x".repeat(200)}\n`;
		const count = Math.floor((MAX_STORE_BYTES - 200) / filler.length);
		const content = `${filler.repeat(count)}\n\n\n`;
		suite.write("project", content);

		const failure = runtime.add("project", "y".repeat(400));

		await expect(failure).rejects.toThrow(/past the \d+-byte cap/);
		expect(suite.read("project")).toBe(content);
	});

	test("writes nothing for a duplicate, and names the note it matched", async () => {
		await runtime.add("project", "use bun");
		const before = statSync(suite.projectPath).ino;

		const result = await runtime.add("project", "Use bun.");

		expect(result.changed).toBe(false);
		expect(result.existing).toBe("[jack] use bun");
		expect(statSync(suite.projectPath).ino).toBe(before);
	});

	// A peer appending between this session's read and its write is what the view has to survive,
	// and no direct write here can stand in for it without a seam in the append itself. The
	// re-read is the fix; this note is the honest limit of the cases below.
	test("carries the stamp, so the appended note says who wrote it", async () => {
		await runtime.add("project", "attributed on the way in");

		expect(readMemoryFile(suite.projectPath)).toContain(
			"- attributed on the way in <!-- by: jack @ 2026-11-18T05:12:00.000Z -->",
		);
	});

	test.skipIf(!POSIX)("creates the store 0600, and narrows one left wider", async () => {
		writeFileSync(suite.projectPath, "- wide\n");
		// A file the umask left readable stands in for one an older build wrote.
		const { chmodSync } = await import("node:fs");
		chmodSync(suite.projectPath, 0o644);

		await appendMemoryNote(suite.projectPath, "narrowed on the way in");

		expect(statSync(suite.projectPath).mode & 0o777).toBe(0o600);
		expect(readFileSync(suite.projectPath, "utf-8")).toContain("- narrowed on the way in");
	});
});
