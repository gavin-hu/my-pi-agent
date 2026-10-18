import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCtx, makeHarnessSuite, settle } from "../../test/helpers/fixtures/watch.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

describe("file sources", () => {
	test("follows appended lines and matches only the pattern", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		h.runtime.load(ctx);
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
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		const watch = h.runtime.add({ path, pattern: "error", exclude: ["ignore"] }, ctx);

		appendFileSync(path, "error ignore me\nerror keep me\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error keep me"]);
	});

	test("fromStart scans existing content", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error old\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);

		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error old"]);
	});

	test("a shrinking file is re-read from the start", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error aaaaaaaa\n");
		const watch = h.runtime.add({ path, pattern: "error" }, ctx);
		h.runtime.tick();

		writeFileSync(path, "error x\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error x"]);
	});

	test("refuses to watch a missing file", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		expect(() => h.runtime.add({ path: "missing.log", pattern: "x" }, ctx)).toThrow(/file not found/);
	});

	test("refuses a path that is not a regular file", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		expect(() => h.runtime.add({ path: h.dir, pattern: "x" }, ctx)).toThrow(/not a regular file/);
	});

	test("a path replaced by a directory is skipped, not thrown", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ cwd: h.dir });
		h.runtime.load(ctx);
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

describe("configuration", () => {
	test("refuses add when watch is disabled", () => {
		const h = suite.makeHarness({ config: { enabled: false } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.add({ command: "build", pattern: "x" }, ctx)).toThrow(/watch is disabled/);
	});
});

describe("command sources", () => {
	test("tails merged stdout and stderr", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);

		h.children[0].write("ok\n");
		h.children[0].emitStderr("FAIL: stderr line\n");

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["FAIL: stderr line"]);
	});

	test("marks a watcher exited when its command closes", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.children[0].close(0);

		expect(h.runtime.get(watch.id)?.status).toBe("exited");
		expect(h.runtime.get(watch.id)?.exitCode).toBe(0);
	});

	test("stop signals the process tree and flushes a partial line", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL partial");

		expect(h.runtime.stop(watch.id)).toBe(true);
		expect(h.runtime.get(watch.id)?.status).toBe("stopped");
		expect(h.runtime.matches(watch.id)?.lines).toEqual(["FAIL partial"]);
		expect(h.kills[0]?.signal).toBe("SIGTERM");
	});

	test("a stopped command that never closes is escalated to SIGKILL", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.runtime.stop(watch.id);
		await settle();

		expect(h.kills.some((kill) => kill.signal === "SIGKILL" && kill.force === true)).toBe(true);
	});

	test("a command that closes after SIGTERM is not force-killed", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.runtime.stop(watch.id);
		h.children[0].close(null, "SIGTERM");
		await settle();

		expect(h.kills.some((kill) => kill.signal === "SIGKILL")).toBe(false);
	});

	test("clear refuses a running watcher unless all is set", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		expect(h.runtime.clear(watch.id, false).refused).toBeDefined();
		expect(h.runtime.clear(watch.id, true).cleared).toBe(1);
		expect(h.runtime.list()).toHaveLength(0);
	});

	test("shutdown is idempotent and leaves nothing running", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.add({ command: "build", pattern: "x" }, ctx);

		await h.runtime.shutdown();
		await h.runtime.shutdown();

		expect(h.runtime.list()).toHaveLength(0);
		expect(h.kills.some((kill) => kill.signal === "SIGTERM")).toBe(true);
		expect(h.kills.some((kill) => kill.signal === "SIGKILL" && kill.force === true)).toBe(true);
	});
});

describe("match reporting", () => {
	test("pending matches survive until marked reported", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const watch = h.runtime.add({ command: "build", pattern: "FAIL", label: "ci" }, ctx);
		h.children[0].write("FAIL\n");

		const pending = h.runtime.pendingMatches();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.watcherId).toBe(watch.id);
		expect(pending[0]?.label).toBe("ci");
		expect(pending[0]?.line).toBe("FAIL");

		h.runtime.markReported(pending);
		expect(h.runtime.pendingMatches()).toHaveLength(0);
	});

	test("a wake watcher fires onMatch once per batch with all pending", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const batches: number[] = [];
		h.runtime.onMatch = (matches) => batches.push(matches.length);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);

		h.children[0].write("FAIL one\nFAIL two\n");

		expect(batches).toEqual([2]);
	});

	test("wakeOnMatch is the default for a new watcher", () => {
		const h = suite.makeHarness({ config: { wakeOnMatch: true } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const seen: number[] = [];
		h.runtime.onMatch = (matches) => seen.push(matches.length);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		expect(seen).toEqual([1]);
	});

	test("an explicit wake overrides the config default", () => {
		const h = suite.makeHarness({ config: { wakeOnMatch: true } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const seen: number[] = [];
		h.runtime.onMatch = (matches) => seen.push(matches.length);
		const watch = h.runtime.add({ command: "build", pattern: "FAIL", wake: false }, ctx);
		h.children[0].write("FAIL\n");
		expect(h.runtime.get(watch.id)?.wake).toBe(false);
		expect(seen).toEqual([]);
	});

	test("unseenCount counts every unreported match", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL one\nFAIL two\n");
		expect(h.runtime.unseenCount()).toBe(2);
	});
});
