/**
 * The file tailers: what a watch reads off a path, and what a rotation does to it.
 *
 * A file watcher holds its own offset and line splitter, so the interesting cases are the
 * ones where the file underneath changes shape — appended, shrunk, or replaced by a
 * rotation that leaves a longer file at the same path. The command and lifecycle suites are
 * `runtime.test.ts`; both start from the fixture's `runtimeHarness`, so a case differing
 * only in the file it writes belongs here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeHarnessSuite, runtimeHarness } from "../../test/helpers/fixtures/watch.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

describe("file watchers", () => {
	test("follows appended lines and matches only the pattern", () => {
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "start\n");
		const watch = h.runtime.add({ path, pattern: "error" }, ctx);

		appendFileSync(path, "all good\nerror: boom\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error: boom"]);
		expect(h.runtime.get(watch.id)?.matchCount).toBe(1);
		expect(h.runtime.get(watch.id)?.linesRead).toBe(2);
	});

	test("an exclude pattern suppresses a match", () => {
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		const watch = h.runtime.add({ path, pattern: "error", exclude: ["ignore"] }, ctx);

		appendFileSync(path, "error ignore me\nerror keep me\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error keep me"]);
	});

	test("fromStart scans existing content", () => {
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error old\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);

		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error old"]);
	});

	test("a shrinking file is re-read from the start", () => {
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error aaaaaaaa\n");
		const watch = h.runtime.add({ path, pattern: "error" }, ctx);
		h.runtime.tick();

		writeFileSync(path, "error x\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error x"]);
	});

	test("a rotated file is read from its start, not from the old file's offset", () => {
		// `logrotate create`: the old file is renamed away and a longer one takes its path. It
		// arrives with more bytes than were consumed, so size alone calls it growth and a stale
		// offset would resume in the middle of the new file — losing its head, silently.
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error old 1\nerror old 2\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);
		h.runtime.tick();
		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error old 1", "error old 2"]);

		renameSync(path, join(h.dir, "app.log.1"));
		writeFileSync(path, "error new 1\nerror new 2\nerror new 3\nerror new 4\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual([
			"error old 1",
			"error old 2",
			"error new 1",
			"error new 2",
			"error new 3",
			"error new 4",
		]);
	});

	test("a replacement shorter than what was read is still read from the start", () => {
		// The size check alone caught this one; identity has to agree rather than regress it.
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error aaaaaaaa\nerror bbbbbbbb\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);
		h.runtime.tick();

		renameSync(path, join(h.dir, "app.log.1"));
		writeFileSync(path, "error new\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error aaaaaaaa", "error bbbbbbbb", "error new"]);
	});

	test("refuses to watch a missing file", () => {
		const { h, ctx } = runtimeHarness(suite);
		expect(() => h.runtime.add({ path: "missing.log", pattern: "x" }, ctx)).toThrow(/file not found/);
	});

	test("refuses a path that is not a regular file", () => {
		const { h, ctx } = runtimeHarness(suite);
		expect(() => h.runtime.add({ path: h.dir, pattern: "x" }, ctx)).toThrow(/not a regular file/);
	});

	test("a path replaced by a directory is skipped, not thrown", () => {
		const { h, ctx } = runtimeHarness(suite);
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error one\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);
		h.runtime.tick();

		rmSync(path);
		mkdirSync(path);

		expect(() => h.runtime.tick()).not.toThrow();
		expect(h.runtime.get(watch.id)?.status).toBe("running");
	});
});
