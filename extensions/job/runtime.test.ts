import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { loadRegistries, REGISTRY_VERSION, saveRegistry } from "./registry.ts";
import { touchSessionMarker } from "./session.ts";
import type { JobRecord } from "./types.ts";
import { makeCtx, makeHarnessSuite, readLog, type Harness } from "../../test/helpers/fixtures/job.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";

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
});

describe("job runtime — pending, clear, status", () => {
	test("takePending returns each finished job once", () => {
		const h = makeHarness();
		start(h);
		h.children[0].close(0);
		expect(h.runtime.takePending().map((j) => j.id)).toEqual(["j1"]);
		expect(h.runtime.takePending()).toEqual([]);
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

	test("hides a live peer's jobs from list but keeps them for id reservation", () => {
		const h = makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [peerRecord({ id: "j9", detached: true })], 10);
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		expect(h.runtime.list().map((job) => job.id)).not.toContain("j9");
		expect(h.runtime.get("j9")?.status).toBe("running");
		expect(h.runtime.start({ command: "mine" }, ctx).id).toBe("j10");
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
		const h = makeHarness();
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
