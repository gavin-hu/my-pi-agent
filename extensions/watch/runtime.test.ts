import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCtx, makeHarnessSuite, settle } from "../../test/helpers/fixtures/watch.ts";
import { DEFAULT_CONFIG, normalizeConfig } from "./config.ts";
import type { WatchConfig } from "./config.ts";
import { MAX_LABEL, normalizeCall } from "./schema.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

describe("watch config", () => {
	test("returns the base for an absent section", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG);
	});

	test("takes booleans and ignores wrongly typed ones", () => {
		const config = normalizeConfig({ enabled: false, showStatus: "no", wakeOnMatch: true }, DEFAULT_CONFIG);
		expect(config.enabled).toBe(false);
		expect(config.showStatus).toBe(true);
		expect(config.wakeOnMatch).toBe(true);
	});

	test("clamps numeric fields into range", () => {
		const config = normalizeConfig(
			{ maxWatchers: 0, maxMatches: 10_000, maxLogLines: -3, matchLines: 5, pollMs: 1 },
			DEFAULT_CONFIG,
		);
		expect(config.maxWatchers).toBe(1);
		expect(config.maxMatches).toBe(5000);
		expect(config.maxLogLines).toBe(1);
		expect(config.matchLines).toBe(5);
		expect(config.pollMs).toBe(100);
	});

	test("keeps the default for a non-numeric value", () => {
		const config = normalizeConfig({ matchLines: null, pollMs: "fast" }, DEFAULT_CONFIG);
		expect(config.matchLines).toBe(DEFAULT_CONFIG.matchLines);
		expect(config.pollMs).toBe(DEFAULT_CONFIG.pollMs);
	});
});

describe("watch call schema", () => {
	test("rejects an unknown action", () => {
		expect(() => normalizeCall({ action: "bogus" })).toThrow(/action must be one of/);
	});

	test("add takes a file path and trims it", () => {
		expect(normalizeCall({ action: "add", path: "  app.log  ", pattern: " error " })).toEqual({
			action: "add",
			path: "app.log",
			pattern: "error",
		});
	});

	test("add takes a command", () => {
		expect(normalizeCall({ action: "add", command: "tail -f x", pattern: "x", exclude: ["a", "b"] })).toEqual({
			action: "add",
			command: "tail -f x",
			pattern: "x",
			exclude: ["a", "b"],
		});
	});

	test("add requires exactly one source", () => {
		expect(() => normalizeCall({ action: "add", pattern: "x" })).toThrow(/requires a path or a command/);
		expect(() => normalizeCall({ action: "add", path: "a", command: "b", pattern: "x" })).toThrow(
			/either a path or a command/,
		);
	});

	test("add requires a compilable pattern", () => {
		expect(() => normalizeCall({ action: "add", path: "a" })).toThrow(/requires a pattern/);
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "(" })).toThrow(/not a valid regular expression/);
	});

	test("add rejects an invalid exclude pattern", () => {
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "x", exclude: ["["] })).toThrow(
			/exclude is not a valid regular expression/,
		);
	});

	test("add rejects an oversized label", () => {
		expect(() => normalizeCall({ action: "add", path: "a", pattern: "x", label: "z".repeat(MAX_LABEL + 1) })).toThrow(
			/label is longer/,
		);
	});

	test("id actions require an id", () => {
		for (const action of ["status", "matches", "logs", "stop"]) {
			expect(() => normalizeCall({ action })).toThrow(/requires an id/);
		}
	});

	test("matches and logs bound their line count", () => {
		expect(() => normalizeCall({ action: "matches", id: "w1", lines: 0 })).toThrow(/lines must be between/);
		expect(normalizeCall({ action: "logs", id: "w1", lines: 10 })).toEqual({ action: "logs", id: "w1", lines: 10 });
	});

	test("clear accepts an optional id and all flag", () => {
		expect(normalizeCall({ action: "clear" })).toEqual({ action: "clear" });
		expect(normalizeCall({ action: "clear", all: true })).toEqual({ action: "clear", all: true });
	});
});

describe("watch runtime", () => {
	function runtimeHarness(options: { config?: Partial<WatchConfig> } = {}) {
		const h = suite.makeHarness(options);
		const { ctx } = makeCtx({ cwd: h.dir });
		h.runtime.load(ctx);
		return { h, ctx };
	}

	test("follows appended lines and matches only the pattern", () => {
		const { h, ctx } = runtimeHarness();
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
		const { h, ctx } = runtimeHarness();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		const watch = h.runtime.add({ path, pattern: "error", exclude: ["ignore"] }, ctx);

		appendFileSync(path, "error ignore me\nerror keep me\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error keep me"]);
	});

	test("fromStart scans existing content", () => {
		const { h, ctx } = runtimeHarness();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error old\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);

		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error old"]);
	});

	test("a shrinking file is re-read from the start", () => {
		const { h, ctx } = runtimeHarness();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error aaaaaaaa\n");
		const watch = h.runtime.add({ path, pattern: "error" }, ctx);
		h.runtime.tick();

		writeFileSync(path, "error x\n");
		h.runtime.tick();

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["error x"]);
	});

	test("refuses to watch a missing file", () => {
		const { h, ctx } = runtimeHarness();
		expect(() => h.runtime.add({ path: "missing.log", pattern: "x" }, ctx)).toThrow(/file not found/);
	});

	test("refuses a path that is not a regular file", () => {
		const { h, ctx } = runtimeHarness();
		expect(() => h.runtime.add({ path: h.dir, pattern: "x" }, ctx)).toThrow(/not a regular file/);
	});

	test("a path replaced by a directory is skipped, not thrown", () => {
		const { h, ctx } = runtimeHarness();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "error one\n");
		const watch = h.runtime.add({ path, pattern: "error", fromStart: true }, ctx);
		h.runtime.tick();

		rmSync(path);
		mkdirSync(path);

		expect(() => h.runtime.tick()).not.toThrow();
		expect(h.runtime.get(watch.id)?.status).toBe("running");
	});

	test("refuses add when watch is disabled", () => {
		const { h, ctx } = runtimeHarness({ config: { enabled: false } });
		expect(() => h.runtime.add({ command: "build", pattern: "x" }, ctx)).toThrow(/watch is disabled/);
	});

	test("refuses add when the live watcher limit is reached", () => {
		const { h, ctx } = runtimeHarness({ config: { maxWatchers: 1 } });
		h.runtime.add({ command: "build", pattern: "x" }, ctx);

		expect(() => h.runtime.add({ command: "build", pattern: "y" }, ctx)).toThrow(/at most 1 watchers/);
	});

	test("tails merged stdout and stderr", () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);

		h.children[0].write("ok\n");
		h.children[0].emitStderr("FAIL: stderr line\n");

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["FAIL: stderr line"]);
	});

	test("logs returns the raw sanitized tail, not only matches", () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);

		h.children[0].write("ok\n\u001b[31mFAIL\u001b[0m\n");

		expect(h.runtime.matches(watch.id)?.lines).toEqual(["FAIL"]);
		expect(h.runtime.logs(watch.id)?.lines).toEqual(["ok", "FAIL"]);
	});

	test("marks a watcher exited when its command closes", () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.children[0].close(0);

		expect(h.runtime.get(watch.id)?.status).toBe("exited");
		expect(h.runtime.get(watch.id)?.exitCode).toBe(0);
	});

	test("stop signals the process tree and flushes a partial line", () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL partial");

		expect(h.runtime.stop(watch.id)).toBe(true);
		expect(h.runtime.get(watch.id)?.status).toBe("stopped");
		expect(h.runtime.matches(watch.id)?.lines).toEqual(["FAIL partial"]);
		expect(h.kills[0]?.signal).toBe("SIGTERM");
	});

	test("a stopped command that never closes is escalated to SIGKILL", async () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.runtime.stop(watch.id);
		await settle();

		expect(h.kills.some((kill) => kill.signal === "SIGKILL" && kill.force === true)).toBe(true);
	});

	test("a command that closes after SIGTERM is not force-killed", async () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		h.runtime.stop(watch.id);
		h.children[0].close(null, "SIGTERM");
		await settle();

		expect(h.kills.some((kill) => kill.signal === "SIGKILL")).toBe(false);
	});

	test("clear refuses a running watcher unless all is set", () => {
		const { h, ctx } = runtimeHarness();
		const watch = h.runtime.add({ command: "build", pattern: "x" }, ctx);

		expect(h.runtime.clear(watch.id, false).refused).toBeDefined();
		expect(h.runtime.clear(watch.id, true).cleared).toBe(1);
		expect(h.runtime.list()).toHaveLength(0);
	});

	test("clear of an unknown id is a no-op", () => {
		const { h } = runtimeHarness();
		expect(h.runtime.clear("w9")).toEqual({ cleared: 0 });
	});

	test("shutdown is idempotent and leaves nothing running", async () => {
		const { h, ctx } = runtimeHarness();
		h.runtime.add({ command: "build", pattern: "x" }, ctx);

		await h.runtime.shutdown();
		await h.runtime.shutdown();

		expect(h.runtime.list()).toHaveLength(0);
		expect(h.kills.some((kill) => kill.signal === "SIGTERM")).toBe(true);
		expect(h.kills.some((kill) => kill.signal === "SIGKILL" && kill.force === true)).toBe(true);
	});

	test("pending matches survive until marked reported", () => {
		const { h, ctx } = runtimeHarness();
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
		const { h, ctx } = runtimeHarness();
		const batches: number[] = [];
		h.runtime.onMatch = (matches) => batches.push(matches.length);
		h.runtime.add({ command: "build", pattern: "FAIL", wake: true }, ctx);

		h.children[0].write("FAIL one\nFAIL two\n");

		expect(batches).toEqual([2]);
	});

	test("wakeOnMatch is the default for a new watcher", () => {
		const { h, ctx } = runtimeHarness({ config: { wakeOnMatch: true } });
		const seen: number[] = [];
		h.runtime.onMatch = (matches) => seen.push(matches.length);
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL\n");
		expect(seen).toEqual([1]);
	});

	test("an explicit wake overrides the config default", () => {
		const { h, ctx } = runtimeHarness({ config: { wakeOnMatch: true } });
		const seen: number[] = [];
		h.runtime.onMatch = (matches) => seen.push(matches.length);
		const watch = h.runtime.add({ command: "build", pattern: "FAIL", wake: false }, ctx);
		h.children[0].write("FAIL\n");
		expect(h.runtime.get(watch.id)?.wake).toBe(false);
		expect(seen).toEqual([]);
	});

	test("unseenCount counts every unreported match", () => {
		const { h, ctx } = runtimeHarness();
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("FAIL one\nFAIL two\n");
		expect(h.runtime.unseenCount()).toBe(2);
	});
});
