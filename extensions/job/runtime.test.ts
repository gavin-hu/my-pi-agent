import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { loadRegistries, projectKey, REGISTRY_VERSION, saveRegistry } from "./registry.ts";
import { touchSessionMarker } from "./session.ts";
import { LOG_ENV } from "./status.ts";
import type { JobRecord } from "./types.ts";
import { makeCtx, makeHarnessSuite, readLog, type Harness } from "../../test/helpers/fixtures/job.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";

const suite = makeHarnessSuite();
const makeHarness = suite.makeHarness;
afterEach(() => suite.cleanup());

/** A persisted record; `statusPath`/`startToken` default to null for the required fields. */
function persisted(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "j1",
		label: "build",
		command: "sleep 99",
		cwd: "/repo",
		pid: 777,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: 1,
		finishedAt: null,
		logPath: "/tmp/j1.log",
		statusPath: null,
		detached: false,
		wake: false,
		stdin: false,
		sessionId: "old",
		seen: false,
		lastLine: "",
		startToken: null,
		...overrides,
	};
}

/** A persisted record belonging to another session. */
function peerRecord(overrides: Partial<JobRecord> = {}): JobRecord {
	return persisted({ label: "peer", sessionId: "peer", ...overrides });
}

/** Persist a session's registry file in the harness directory. */
function save(h: Harness, sessionId: string, jobs: JobRecord[], counter = jobs.length + 1): void {
	saveRegistry(h.dir, { version: REGISTRY_VERSION, sessionId, counter, jobs });
}

/** Every persisted record across all session files. */
function persistedIds(h: Harness): string[] {
	return loadRegistries(h.dir)
		.files.flatMap((file) => file.jobs)
		.map((job) => job.id)
		.sort();
}

function start(h: Harness, command = "sleep 10"): void {
	const { ctx } = makeCtx();
	h.runtime.load(ctx);
	h.runtime.start({ command }, ctx);
}

describe("job runtime — start", () => {
	test("spawns, records a running job, and assigns ids", () => {
		const h = makeHarness();
		start(h);
		const job = h.runtime.get("j1");
		expect(job?.status).toBe("running");
		expect(job?.pid).toBe(h.children[0].pid);
		expect(h.children[0].command).toContain("sleep 10");
		expect(h.runtime.runningCount()).toBe(1);
	});

	test("creates the registry directory before reserving an id", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		// A first job in a project whose registry directory does not exist yet
		// must still be able to reserve its id (`O_EXCL` lock inside that dir).
		rmSync(h.dir, { recursive: true, force: true });
		const job = h.runtime.start({ command: "sleep 10" }, ctx);
		expect(existsSync(h.dir)).toBe(true);
		expect(job.id).toBe("j1");
	});

	test("uses the label when given and the command otherwise", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(h.runtime.start({ command: "bun test", label: "tests" }, ctx).label).toBe("tests");
		expect(h.runtime.start({ command: "bun build" }, ctx).label).toBe("bun build");
	});

	test("streams output into the log file and caches the last line", async () => {
		const h = makeHarness();
		start(h);
		const job = h.runtime.get("j1")!;
		h.children[0].write("one\n two \n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "two");
		await waitFor(() => readLog(job.logPath).includes("one"));
		expect(h.runtime.get("j1")?.lastLine).toBe("two");
	});

	test("sanitizes ANSI in the cached last line", async () => {
		const h = makeHarness();
		start(h);
		h.children[0].write("\u001b[31mred\u001b[0m\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "red");
	});

	test("sanitizes a label with escape sequences", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const job = h.runtime.start({ command: "true", label: "\u001b[31mred\u001b[0m" }, ctx);
		expect(job.label).toBe("red");
	});

	test("records a status path so a POSIX job can recover its exit code", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const job = h.runtime.start({ command: "true" }, ctx);
		if (process.platform === "win32") expect(job.statusPath).toBeNull();
		else expect(job.statusPath).toContain(`${job.id}.status`);
	});

	test("auto-kills a job after its timeout", async () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1", timeoutMs: 10 }, ctx);
		const pid = h.children[0].pid;
		await waitFor(() => h.kills.some((k) => k.pid === pid && k.signal === "SIGTERM"), 100);
	});

	test("does not kill a job that finishes before its timeout", async () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "true", timeoutMs: 20 }, ctx);
		h.children[0].close(0);
		await settle(50);
		expect(h.kills).toHaveLength(0);
	});
});

describe("job runtime — finish", () => {
	test("a clean exit becomes exited", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(0);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
		expect(h.runtime.runningCount()).toBe(0);
	});

	test("a non-zero exit becomes failed", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(2);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(2);
	});

	test("a signal close becomes killed", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(null, "SIGTERM");
		expect(h.runtime.get("j1")?.status).toBe("killed");
		expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
	});

	test("notifies once when a job fails", () => {
		const h = makeHarness();
		const { ctx, notifications } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1", label: "build" }, ctx);
		h.children[0].close(2);
		expect(notifications).toEqual(["Job j1 failed: build (exit 2)"]);
	});

	test("does not notify on a clean exit", () => {
		const h = makeHarness();
		const { ctx, notifications } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(0);
		expect(notifications).toEqual([]);
	});

	test("reports a completion to onComplete exactly once", () => {
		const h = makeHarness();
		const seen: Array<{ id: string; status: string; exitCode: number | null }> = [];
		h.runtime.onComplete = (job) => seen.push({ id: job.id, status: job.status, exitCode: job.exitCode });
		start(h);
		h.children[0].close(2);
		expect(seen).toEqual([{ id: "j1", status: "failed", exitCode: 2 }]);
	});
});

describe("job runtime — kill", () => {
	test("sends SIGTERM to the process group", () => {
		const h = makeHarness();
		start(h);
		const pid = h.children[0].pid;
		h.runtime.kill("j1");
		expect(h.kills).toEqual([{ pid, signal: "SIGTERM", force: false }]);
	});

	test("SIGKILL forces and escalates nothing", () => {
		const h = makeHarness();
		start(h);
		const pid = h.children[0].pid;
		h.runtime.kill("j1", "SIGKILL");
		expect(h.kills[0]).toMatchObject({ pid, signal: "SIGKILL", force: true });
	});

	test("killing a finished job is a no-op", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(0);
		h.runtime.kill("j1");
		expect(h.kills).toHaveLength(0);
	});
});

describe("job runtime — send", () => {
	/** Load the runtime and start a job that opted into a stdin pipe. */
	function startWithStdin(h: Harness) {
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		return h.runtime.start({ command: "cat", stdin: true }, ctx);
	}

	test("opens a stdin pipe only when the job asks for one", () => {
		const h = makeHarness();
		start(h);
		expect(h.children[0].options?.stdin).toBe(false);
		expect(h.runtime.get("j1")?.stdin).toBe(false);

		const piped = makeHarness();
		const job = startWithStdin(piped);
		expect(piped.children[0].options?.stdin).toBe(true);
		expect(job.stdin).toBe(true);
	});

	test("writes a line and adds the newline itself", () => {
		const h = makeHarness();
		startWithStdin(h);
		const result = h.runtime.send("j1", { input: "hello" });
		expect(result.sent).toBe(5);
		expect(result.closed).toBe(false);
		expect(h.children[0].stdinSink?.text).toBe("hello\n");
	});

	test("writes verbatim when newline is false", () => {
		const h = makeHarness();
		startWithStdin(h);
		h.runtime.send("j1", { input: "y", newline: false });
		expect(h.children[0].stdinSink?.text).toBe("y");
	});

	test("ends stdin on eof and refuses a later write", () => {
		const h = makeHarness();
		startWithStdin(h);
		const result = h.runtime.send("j1", { input: "bye", eof: true });
		expect(result.closed).toBe(true);
		expect(h.children[0].stdinSink?.text).toBe("bye\n");
		expect(h.children[0].stdinSink?.ended).toBe(true);
		expect(() => h.runtime.send("j1", { input: "again" })).toThrow("closed its stdin");
	});

	test("closes stdin without writing when eof is all it is given", () => {
		const h = makeHarness();
		startWithStdin(h);
		h.runtime.send("j1", { eof: true });
		expect(h.children[0].stdinSink?.text).toBe("");
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	test("refuses a job started without stdin", () => {
		const h = makeHarness();
		start(h);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("was not started with stdin");
	});

	test("refuses an unknown or finished job", () => {
		const h = makeHarness();
		startWithStdin(h);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow('no job "j9"');
		h.children[0].close(0);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("is exited; stdin is closed");
	});

	test("refuses a running job whose pipe belongs to another session", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ id: "j9", detached: true, stdin: true })], 10);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow("belongs to the session that started it");
	});

	test("reports a closed pipe when the child closed its end", () => {
		const h = makeHarness();
		startWithStdin(h);
		const sink = h.children[0].stdinSink;
		if (!sink) throw new Error("expected a stdin pipe");
		sink.failWith = new Error("EPIPE");
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
		// The pipe is dropped, so the next call says the same thing without writing.
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
	});

	test("ends stdin when the job's process closes", () => {
		const h = makeHarness();
		startWithStdin(h);
		h.children[0].close(0);
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	// Detached stdin is POSIX-only: Windows refuses the detach before the pipe is
	// considered, so these pin the host instead of the one the suite runs on.
	test("rejects stdin on a detached job", () => {
		const h = makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.start({ command: "cat", stdin: true, detached: true }, ctx)).toThrow("cannot take stdin");
	});

	test("rejects stdin when detached is the configured default", () => {
		const h = makeHarness({ isWindows: () => false, config: { detachedByDefault: true } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.start({ command: "cat", stdin: true }, ctx)).toThrow("cannot take stdin");
	});
});

describe("job runtime — Windows", () => {
	/** A harness that believes it is Windows, whichever host is running the test. */
	const windows = (options: Parameters<typeof makeHarness>[0] = {}) =>
		makeHarness({ ...options, isWindows: () => true });

	test("refuses an explicit detach, naming every way out", () => {
		const h = windows();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		let message = "";
		try {
			h.runtime.start({ command: "sleep 60", detached: true }, ctx);
		} catch (error) {
			message = (error as Error).message;
		}

		expect(message).toContain("cannot outlive the session on Windows");
		expect(message).toContain("detached: false");
		expect(message).toContain("WSL");
		expect(message).toContain("subagent");
	});

	test("a refused start spawns nothing and reserves no id", () => {
		const h = windows();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		expect(() => h.runtime.start({ command: "sleep 60", detached: true }, ctx)).toThrow();
		expect(h.children).toHaveLength(0);
		expect(h.runtime.list()).toEqual([]);

		// The next accepted start is the first id, not the one the refusal burned.
		expect(h.runtime.start({ command: "true" }, ctx).id).toBe("j1");
	});

	test("ignores a configured detach default instead of failing every start", () => {
		const h = windows({ config: { detachedByDefault: true } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		const job = h.runtime.start({ command: "true" }, ctx);

		expect(job.detached).toBe(false);
		expect(job.statusPath).toBeNull();
	});

	test("starts an attached job when the call asks for one", () => {
		const h = windows();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		const job = h.runtime.start({ command: "true", detached: false }, ctx);

		expect(job.detached).toBe(false);
		// Attached jobs keep a parent-owned log stream and their exit code from the
		// child's own `close`, which is the whole Windows story.
		expect(readLog(job.logPath)).toBe("");
	});

	test("still detaches on POSIX, so the refusal cannot leak across platforms", () => {
		const h = makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		expect(h.runtime.start({ command: "true", detached: true }, ctx).detached).toBe(true);
	});
});

describe("job runtime — logs", () => {
	test("returns a sanitized tail", async () => {
		const h = makeHarness();
		start(h);
		h.children[0].write("a\nb\nc\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "c");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("c"));
		const result = h.runtime.logs("j1", 2);
		expect(result?.text).toContain("b");
		expect(result?.text).toContain("c");
		expect(result?.text).not.toContain("\na\n");
		expect(result?.lines).toEqual(["b", "c"]);
		expect(result?.lines.join("\n")).not.toContain("output:");
	});

	test("keeps a multi-byte character that a read boundary splits", async () => {
		const h = makeHarness();
		start(h);
		const bytes = Buffer.from("héllo\n", "utf8");
		// é is two bytes; cut between them, as a pipe read can.
		const cut = bytes.indexOf(0xc3) + 1;
		h.children[0].writeBytes(bytes.subarray(0, cut));
		h.children[0].writeBytes(bytes.subarray(cut));
		await waitFor(() => h.runtime.get("j1")?.lastLine === "héllo");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("héllo"));
		expect(h.runtime.logs("j1")?.lines).toContain("héllo");
	});

	test("defaults to the configured maxLogLines", async () => {
		const h = makeHarness({ config: { maxLogLines: 2 } });
		start(h);
		h.children[0].write("a\nb\nc\nd\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "d");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("d"));
		const result = h.runtime.logs("j1");
		expect(result?.text).toContain("c");
		expect(result?.text).toContain("d");
		expect(result?.text).not.toContain("\na\n");
	});

	test("flags that earlier lines exist beyond the returned window", async () => {
		const h = makeHarness({ config: { maxLogLines: 2 } });
		start(h);
		h.children[0].write("a\nb\nc\nd\ne\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "e");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("e"));
		expect(h.runtime.logs("j1")?.more).toBe(true);
	});
});

describe("job runtime — wait", () => {
	test("resolves when the job finishes", async () => {
		const h = makeHarness();
		start(h);
		const promise = h.runtime.wait("j1", 1000, undefined);
		h.children[0].close(0);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
		expect(result?.job.status).toBe("exited");
	});

	test("times out while the job keeps running", async () => {
		const h = makeHarness();
		start(h);
		const result = await h.runtime.wait("j1", 0, undefined);
		expect(result?.timedOut).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});

	test("cancels on abort without killing the job", async () => {
		const h = makeHarness();
		start(h);
		const controller = new AbortController();
		const promise = h.runtime.wait("j1", 10_000, controller.signal);
		controller.abort();
		const result = await promise;
		expect(result?.cancelled).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});
});

describe("job runtime — registry reconcile", () => {
	test("recovers an exit code from the status file", () => {
		const h = makeHarness();
		h.dead.add(888);
		save(h, "old", [persisted({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "0", "utf-8");
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
	});

	test("recovers a non-zero exit code as failed", () => {
		const h = makeHarness();
		h.dead.add(888);
		save(h, "old", [persisted({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "3", "utf-8");
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(3);
	});

	test("refuses to signal a pid whose start token changed", () => {
		const h = makeHarness({ startToken: () => "new" });
		save(h, "old", [persisted({ startToken: "old" })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.kills).toHaveLength(0);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("adopts a dead session's records and deletes its file", () => {
		const h = makeHarness();
		save(h, "old", [persisted({ detached: true, status: "exited", exitCode: 0, finishedAt: 5, sessionId: "old" })], 2);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.get("j1")?.sessionId).toBe("me");
		expect(h.runtime.get("j1")?.status).toBe("exited");
		const files = loadRegistries(h.dir).files.map((file) => file.sessionId);
		expect(files).not.toContain("old");
		expect(persistedIds(h)).toContain("j1");
	});

	test("polls a reattached detached job when its pid disappears", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		save(h, "old", [persisted({ label: "server", command: "dev", detached: true })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("wakes for a reattached wake job that finishes", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		const fired: string[] = [];
		h.runtime.onFinish = (job) => fired.push(job.id);
		save(h, "old", [persisted({ label: "server", command: "dev", detached: true, wake: true })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
		expect(fired).toEqual(["j1"]);
	});

	test("reports a reattached job observed gone", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (job) => seen.push(`${job.id}:${job.status}`);
		save(h, "old", [persisted({ label: "server", command: "dev", detached: true })], 2);
		h.runtime.load(makeCtx().ctx);
		h.dead.add(777);
		await settle(60);
		expect(seen).toEqual(["j1:unknown"]);
	});

	test("does not report a reattached job with no pid to judge", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (job) => seen.push(job.id);
		save(h, "old", [persisted({ label: "server", command: "dev", detached: true, pid: null })], 2);
		h.runtime.load(makeCtx().ctx);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("running");
		expect(seen).toEqual([]);
	});
});

describe("job runtime — pending, clear, status", () => {
	test("pendingCompletions peeks and markReported marks", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(0);
		expect(h.runtime.pendingCompletions().map((j) => j.id)).toEqual(["j1"]);
		expect(h.runtime.pendingCompletions().map((j) => j.id)).toEqual(["j1"]);
		h.runtime.markReported(["j1"]);
		expect(h.runtime.pendingCompletions()).toEqual([]);
	});

	test("clear removes finished jobs but refuses running ones", () => {
		const h = makeHarness();
		start(h);
		expect(h.runtime.clear("j1", false).refused).toContain("still running");
		h.children[0].close(0);
		expect(h.runtime.clear(undefined, false).cleared).toBe(1);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("clear all resolves a pending wait", async () => {
		const h = makeHarness();
		start(h);
		const promise = h.runtime.wait("j1", 10_000, undefined);
		h.runtime.clear(undefined, true);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
	});

	test("clear with all force-removes running jobs", () => {
		const h = makeHarness();
		start(h);
		const pid = h.children[0].pid;
		expect(h.runtime.clear(undefined, true).cleared).toBe(1);
		expect(h.kills.some((k) => k.pid === pid && k.signal === "SIGKILL")).toBe(true);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("status chip shows the running count and clears at zero", () => {
		const h = makeHarness();
		const { ctx, statuses } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
		h.runtime.start({ command: "sleep 10" }, ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs")).toBe("▸ 1");
		h.children[0].close(0);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("status chips show the running and unreported-failure counts separately", () => {
		const h = makeHarness();
		const { ctx, statuses } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx); // j1
		h.runtime.start({ command: "sleep 1" }, ctx); // j2, stays running
		h.children[0].close(1); // j1 fails, unreported
		h.runtime.setStatus(ctx);
		expect(statuses.get("jobs")).toBe("▸ 1");
		expect(statuses.get("jobs-failure")).toBe("✗ 1");
	});

	test("shows a live peer's jobs and keeps their ids reserved", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ id: "j9", detached: true })], 10);
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		// Visible, but owned by the peer: the row is tagged and the record cannot be
		// cleared here, while its id stays reserved.
		expect(h.runtime.list().map((job) => job.id)).toContain("j9");
		expect(h.runtime.list().find((job) => job.id === "j9")?.sessionId).toBe("peer");
		expect(h.runtime.sessionId).toBe("me");
		expect(h.runtime.get("j9")?.status).toBe("running");
		expect(h.runtime.start({ command: "mine" }, ctx).id).toBe("j10");
	});

	test("clear refuses another session's finished job", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(
			h,
			"peer",
			[peerRecord({ id: "j9", detached: true, status: "exited", exitCode: 0, pid: null, finishedAt: 5 })],
			10,
		);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.clear("j9", false).refused).toContain("another live session");
	});

	test("does not count a live peer's running job in the chip", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ id: "j9", detached: true })], 10);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("ignores a live peer's unreported failure in the chip", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ status: "failed", exitCode: 1, pid: null, finishedAt: 5 })], 2);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs-failure")).toBe(false);
	});

	test("re-asserts the chip on the repaint clock after an external clear", async () => {
		const h = makeHarness({ config: { repaintMs: 10 } });
		const { ctx, statuses } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 10" }, ctx);
		expect(statuses.get("jobs")).toContain("1");
		// Simulate something clearing the status while the job keeps running.
		statuses.delete("jobs");
		await settle(60);
		expect(statuses.get("jobs")).toContain("1");
	});

	test("shutdown kills non-detached jobs and keeps detached ones", async () => {
		// Detached jobs exist on POSIX only; pin the host rather than the runner's.
		const h = makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "a" }, ctx);
		h.runtime.start({ command: "b", detached: true }, ctx);
		const detachedPid = h.children[1].pid;
		await h.runtime.shutdown();
		expect(h.kills.some((k) => k.pid === h.children[0].pid)).toBe(true);
		expect(h.kills.some((k) => k.pid === detachedPid)).toBe(false);
	});

	test("shutdown leaves a live peer's job running", async () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ detached: false })], 2);
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		await h.runtime.shutdown();
		expect(h.kills.some((k) => k.pid === 777)).toBe(false);
	});

	test("persist keeps a peer session's file intact", () => {
		const h = makeHarness();
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		save(h, "peer", [peerRecord({ id: "j9", detached: true })], 10);
		const job = h.runtime.start({ command: "mine" }, ctx);
		expect(job.id).toBe("j10");
		expect(persistedIds(h)).toContain("j9");
		expect(persistedIds(h)).toContain("j10");
		expect(loadRegistries(h.dir).files.some((file) => file.sessionId === "peer")).toBe(true);
	});
});

describe("job runtime — detached output and registry root", () => {
	const posix = process.platform !== "win32";

	test.skipIf(!posix)("gives a detached job its own output and unrefs it", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "serve", detached: true }, ctx);
		const child = h.children[0];
		expect(child.options?.detachOutput).toBe(true);
		expect(child.unrefed).toBe(true);
		expect(String(child.options?.env?.[LOG_ENV])).toContain("j1.log");
	});

	test("keeps the parent pipe for a non-detached job", () => {
		const h = makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(false);
		expect(h.children[0].unrefed).toBe(false);
	});

	test("anchors the registry to the session cwd, not a worktree root set later", async () => {
		await withAgentDir(async (agentDir) => {
			const worktree = tempDir("pi-jobs-wt-");
			const h = makeHarness({ config: { registryDir: undefined } });
			const { ctx } = makeCtx({ cwd: "/repo/main" });
			await withEnv({ PI_WORKTREE_ROOT: worktree }, async () => {
				h.runtime.load(ctx);
				h.runtime.start({ command: "sleep 1" }, ctx);
			});
			expect(existsSync(join(agentDir, "jobs", projectKey("/repo/main")))).toBe(true);
			expect(existsSync(join(agentDir, "jobs", projectKey(worktree)))).toBe(false);
		});
	});
});

describe("job runtime — log rotation", () => {
	/** Start a job with a cap small enough that a couple of lines rotate it. */
	function startCapped(h: Harness): string {
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "chatty" }, ctx);
		const logPath = h.runtime.get("j1")?.logPath;
		if (!logPath) throw new Error("expected a log path");
		return logPath;
	}

	test("moves the live segment aside once it reaches the cap", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		// Each write waits for the file, so the stream's byte count matches the file
		// and the third line deterministically crosses the 8-byte cap.
		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", 200);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", 200);
		h.children[0].write("cccc\n");
		// The rename lands before the reopened stream flushes its queued chunk, so
		// wait for both halves rather than asserting on an empty live segment.
		await waitFor(() => readLog(rotated) === "aaaa\nbbbb\n" && readLog(logPath) === "cccc\n", 200);
	});

	test("keeps one previous segment and replaces it on the next rotation", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		for (const line of ["aaaa", "bbbb", "cccc", "dddd", "eeee"]) {
			h.children[0].write(`${line}\n`);
			await waitFor(() => readLog(logPath).includes(line) || readLog(rotated).includes(line), 200);
		}

		// Two rotations by the fifth line: the first pair moves to `.1`, the second
		// pair replaces it, and the newest line starts the live segment again.
		await waitFor(() => readLog(rotated) === "cccc\ndddd\n" && readLog(logPath) === "eeee\n", 200);
		expect(existsSync(rotated)).toBe(true);
		expect(existsSync(`${rotated}.1`)).toBe(false);
		// The oldest line was rotated out of the only previous segment.
		expect(readLog(rotated)).not.toContain("aaaa");
		expect(readLog(logPath)).toContain("eeee");
	});

	test("drains a rotation backlog through the cap instead of one oversized segment", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", 200);

		// The first chunk starts a rotation; the next two arrive while it is in
		// flight. They are replayed through the cap check, so the new segment is
		// bounded and the order across the two segments is unchanged.
		h.children[0].write("bbbb\n");
		h.children[0].write("cccc\n");
		h.children[0].write("dddd\n");
		await waitFor(() => existsSync(rotated) && readLog(logPath).includes("dddd"), 200);
		await settle(20);

		expect(readLog(rotated) + readLog(logPath)).toBe("aaaa\nbbbb\ncccc\ndddd\n");
		expect(readLog(logPath).length).toBeLessThanOrEqual(8 + "dddd\n".length);
	});

	test("logs reads across the rotated segment", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8, maxLogLines: 10 } });
		const logPath = startCapped(h);

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", 200);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", 200);
		h.children[0].write("cccc\n");
		await waitFor(() => readLog(logPath) === "cccc\n" && existsSync(join(h.dir, "j1.log.1")), 200);

		expect(h.runtime.logs("j1", 10)?.lines).toEqual(["aaaa", "bbbb", "cccc"]);
	});

	test("clear removes both segments", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", 200);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", 200);
		h.children[0].write("cccc\n");
		await waitFor(() => existsSync(rotated), 200);

		h.children[0].close(0);
		h.runtime.clear("j1", false);
		expect(existsSync(logPath)).toBe(false);
		expect(existsSync(rotated)).toBe(false);
	});

	test("a detached job writes its own log and is not rotated", () => {
		if (process.platform === "win32") return;
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const job = h.runtime.start({ command: "serve", detached: true }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(true);

		// The parent holds no stream for it, so no chunk is seen and nothing rotates.
		h.children[0].write("aaaaaaaaaaaaaaaaaaaa\n");
		h.children[0].write("bbbbbbbbbbbbbbbbbbbb\n");
		expect(existsSync(join(h.dir, "j1.log.1"))).toBe(false);
		expect(job.detached).toBe(true);
	});

	test("a finished job never leaves a reopened stream behind", async () => {
		const h = makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", 200);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", 200);

		// The third line starts a rotation; the close arrives before the stream's own
		// `close`, so the pending callback must bail instead of renaming and reopening.
		h.children[0].write("cccc\n");
		h.children[0].close(0);
		await settle(20);

		expect(existsSync(rotated)).toBe(false);
		expect(readLog(logPath)).toBe("aaaa\nbbbb\n");
	});
});
