import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "./config.ts";
import { readLogTail } from "./logs.ts";
import {
	loadRegistries,
	mergeRecords,
	parseRegistry,
	planReconcile,
	projectKey,
	REGISTRY_VERSION,
	registryDirFor,
	removeLegacyRegistry,
	removeRegistry,
	saveRegistry,
	settleGone,
} from "./registry.ts";
import { listReservedIds, pruneReservations, releaseReservation, reserveId } from "./reservations.ts";
import { createJobsRuntime, type JobsRuntime } from "./runtime.ts";
import { MAX_COMMAND, MAX_LABEL, MAX_STDIN, normalizeCall, type JobCall } from "./schema.ts";
import {
	isSessionAlive,
	listSessionMarkers,
	pruneSessionMarkers,
	readSessionMarker,
	removeSessionMarker,
	sessionMarkerPath,
	touchSessionMarker,
} from "./session.ts";
import { LOG_ENV, STATUS_ENV, readExitStatus, withExitTrap } from "./status.ts";
import { createJobStore } from "./store.ts";
import type { Job, JobRecord } from "./types.ts";
import { createWaiters } from "./waiters.ts";
import { makeCtx, makeHarnessSuite, readLog, type Harness } from "../../test/helpers/fixtures/job.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();
afterEach(() => {
	suite.cleanup();
	temps.flush();
});

/** A persisted record; `statusPath`/`startToken` default to null for the required fields. */
function record(overrides: Partial<JobRecord> = {}): JobRecord {
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

/** The in-memory shape the store persists. */
function job(overrides: Partial<JobRecord> = {}): Job {
	return { ...record(overrides), owned: true };
}

/** Persist a session's registry file in the harness directory. */
function save(h: Harness, sessionId: string, jobs: JobRecord[], counter = jobs.length + 1): void {
	saveRegistry(h.dir, { version: REGISTRY_VERSION, sessionId, counter, jobs });
}

/** Every persisted record across all session files. */
function persistedIds(h: Harness): string[] {
	return loadRegistries(h.dir)
		.files.flatMap((file) => file.jobs)
		.map((entry) => entry.id)
		.sort();
}

function start(h: Harness, command = "sleep 10"): void {
	const { ctx } = makeCtx();
	h.runtime.load(ctx);
	h.runtime.start({ command }, ctx);
}

/** Narrow a normalized call to one action, or fail the test. */
function asAction<A extends JobCall["action"]>(call: JobCall, action: A): Extract<JobCall, { action: A }> {
	if (call.action !== action) throw new Error(`expected ${action}, got ${call.action}`);
	return call as Extract<JobCall, { action: A }>;
}

function statusDir(): string {
	return temps.track(tempDir("pi-jobs-status-"));
}

function runtimeWithFailedSpawn(dir: string): JobsRuntime {
	return createJobsRuntime({
		spawn: () => {
			throw new Error("spawn failed");
		},
		killTree: () => {},
		liveness: () => false,
		now: () => 1000,
		config: { ...DEFAULT_CONFIG, registryDir: dir },
		isWindows: () => false,
	});
}

describe("job schema", () => {
	test("rejects an unknown action", () => {
		expect(() => normalizeCall({ action: "explode" })).toThrow("action must be one of");
		expect(() => normalizeCall({})).toThrow("action must be one of");
	});

	test("accepts each valid action", () => {
		for (const action of ["list", "clear"] as const) {
			expect(normalizeCall({ action }).action).toBe(action);
		}
	});

	test("start requires a non-empty command and trims it", () => {
		expect(() => normalizeCall({ action: "start" })).toThrow("requires a command");
		expect(() => normalizeCall({ action: "start", command: "   " })).toThrow("requires a command");
		expect(asAction(normalizeCall({ action: "start", command: "  bun test  " }), "start").command).toBe("bun test");
	});

	test("start rejects an over-long command", () => {
		expect(() => normalizeCall({ action: "start", command: "x".repeat(MAX_COMMAND + 1) })).toThrow("longer than");
	});

	test("start rejects an over-long label but accepts a normal one", () => {
		expect(() => normalizeCall({ action: "start", command: "x", label: "y".repeat(MAX_LABEL + 1) })).toThrow(
			"longer than",
		);
		expect(asAction(normalizeCall({ action: "start", command: "x", label: " build " }), "start").label).toBe("build");
	});

	test("start forwards wake, detached, and cwd", () => {
		const call = asAction(
			normalizeCall({ action: "start", command: "x", wake: true, detached: true, cwd: " /repo " }),
			"start",
		);
		expect(call.wake).toBe(true);
		expect(call.detached).toBe(true);
		expect(call.cwd).toBe("/repo");
	});

	test("start validates and forwards the auto-kill timeout", () => {
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 0 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(() => normalizeCall({ action: "start", command: "x", timeoutMs: 86_400_001 })).toThrow(
			"timeoutMs must be between",
		);
		expect(asAction(normalizeCall({ action: "start", command: "x", timeoutMs: 5000 }), "start").timeoutMs).toBe(5000);
	});

	test("start forwards the stdin opt-in", () => {
		expect(asAction(normalizeCall({ action: "start", command: "x", stdin: true }), "start").stdin).toBe(true);
		expect(asAction(normalizeCall({ action: "start", command: "x" }), "start").stdin).toBeUndefined();
	});

	test("id-taking actions require an id", () => {
		for (const action of ["status", "logs", "send", "kill", "wait"]) {
			expect(() => normalizeCall({ action })).toThrow("requires an id");
		}
		expect(asAction(normalizeCall({ action: "status", id: "j2" }), "status").id).toBe("j2");
	});

	test("logs validates line bounds", () => {
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 0 })).toThrow("lines must be between");
		expect(() => normalizeCall({ action: "logs", id: "j1", lines: 99999 })).toThrow("lines must be between");
		expect(asAction(normalizeCall({ action: "logs", id: "j1", lines: 50 }), "logs").lines).toBe(50);
	});

	test("kill validates the signal", () => {
		expect(() => normalizeCall({ action: "kill", id: "j1", signal: "SIGUSR1" })).toThrow("signal must be one of");
		expect(asAction(normalizeCall({ action: "kill", id: "j1", signal: "SIGKILL" }), "kill").signal).toBe("SIGKILL");
		expect(asAction(normalizeCall({ action: "kill", id: "j1" }), "kill").signal).toBeUndefined();
	});

	test("wait validates the timeout", () => {
		expect(() => normalizeCall({ action: "wait", id: "j1", timeoutMs: -1 })).toThrow("timeoutMs must be between");
		expect(asAction(normalizeCall({ action: "wait", id: "j1", timeoutMs: 100 }), "wait").timeoutMs).toBe(100);
	});

	test("clear forwards all", () => {
		expect(asAction(normalizeCall({ action: "clear", all: true }), "clear").all).toBe(true);
	});

	test("send requires input or eof", () => {
		expect(() => normalizeCall({ action: "send", id: "j1" })).toThrow("requires `input` or `eof: true`");
		expect(() => normalizeCall({ action: "send", id: "j1", input: "" })).toThrow("requires `input` or `eof: true`");
		expect(asAction(normalizeCall({ action: "send", id: "j1", eof: true }), "send").eof).toBe(true);
		expect(asAction(normalizeCall({ action: "send", id: "j1", eof: true }), "send").input).toBeUndefined();
	});

	test("send caps the input length and rejects a non-string", () => {
		expect(() => normalizeCall({ action: "send", id: "j1", input: "x".repeat(MAX_STDIN + 1) })).toThrow("longer than");
		expect(() => normalizeCall({ action: "send", id: "j1", input: 5 })).toThrow("must be a string");
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "hi" }), "send").input).toBe("hi");
	});

	test("send forwards newline and eof only when given", () => {
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y", newline: false }), "send").newline).toBe(
			false,
		);
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y" }), "send").newline).toBeUndefined();
		expect(asAction(normalizeCall({ action: "send", id: "j1", input: "y", eof: true }), "send").eof).toBe(true);
	});
});

describe("job registry", () => {
	test("projectKey is stable per directory and differs across directories", () => {
		expect(projectKey("/a/repo")).toBe(projectKey("/a/repo"));
		expect(projectKey("/a/repo")).not.toBe(projectKey("/b/repo"));
		expect(projectKey("/a/repo")).toContain("repo");
	});

	test("registryDirFor honours an explicit override", () => {
		expect(registryDirFor("/a/repo", "/custom/dir")).toBe(resolve("/custom/dir"));
	});

	test("registryDirFor defaults under the agent dir so PI_CODING_AGENT_DIR isolates it", async () => {
		await withAgentDir((dir) => {
			expect(registryDirFor("/a/repo")).toBe(join(dir, "jobs", projectKey("/a/repo")));
		});
	});

	test("parseRegistry yields an empty registry for non-objects", () => {
		expect(parseRegistry(null)).toEqual({
			version: REGISTRY_VERSION,
			sessionId: "unknown",
			counter: 1,
			jobs: [],
		});
		expect(parseRegistry([]).jobs).toEqual([]);
	});

	test("parseRegistry skips malformed job entries and normalizes optional fields", () => {
		const parsed = parseRegistry({
			sessionId: "s1",
			counter: 5,
			jobs: [record(), { id: "bad" }, 7, { ...record({ id: "j2" }), statusPath: undefined, startToken: undefined }],
		});
		expect(parsed.counter).toBe(5);
		expect(parsed.sessionId).toBe("s1");
		expect(parsed.jobs).toHaveLength(2);
		expect(parsed.jobs[1].statusPath).toBeNull();
		expect(parsed.jobs[1].startToken).toBeNull();
	});

	test("parseRegistry falls back to counter 1 for a bad counter", () => {
		expect(parseRegistry({ counter: -3, jobs: [] }).counter).toBe(1);
	});

	test("parseRegistry uses the fallback session when the file has none", () => {
		expect(parseRegistry({ counter: 1, jobs: [] }, "legacy").sessionId).toBe("legacy");
	});

	test("saveRegistry round-trips one session's file", () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "s1", counter: 3, jobs: [record()] });
		const { files, counter } = loadRegistries(dir);
		expect(files).toHaveLength(1);
		expect(files[0].sessionId).toBe("s1");
		expect(files[0].jobs).toHaveLength(1);
		expect(counter).toBe(3);
	});

	test("loadRegistries merges files from multiple sessions without clobbering", () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "a",
			counter: 2,
			jobs: [record({ id: "j1", sessionId: "a" })],
		});
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "b",
			counter: 7,
			jobs: [record({ id: "j2", sessionId: "b" })],
		});
		const { files, counter } = loadRegistries(dir);
		expect(files.map((file) => file.sessionId).sort()).toEqual(["a", "b"]);
		expect(counter).toBe(7);
	});

	test("reads and removes a legacy shared registry", () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		writeFileSync(
			join(dir, "registry.json"),
			JSON.stringify({ version: REGISTRY_VERSION, counter: 4, jobs: [record()] }),
			"utf-8",
		);
		const { files, counter } = loadRegistries(dir);
		expect(files[0].sessionId).toBe("legacy");
		expect(counter).toBe(4);
		removeLegacyRegistry(dir);
		expect(loadRegistries(dir).files).toEqual([]);
	});

	test("removeRegistry deletes only the named session's file", () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "a", counter: 1, jobs: [] });
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "b", counter: 1, jobs: [] });
		removeRegistry(dir, "a");
		expect(loadRegistries(dir).files.map((file) => file.sessionId)).toEqual(["b"]);
	});

	test("mergeRecords lets a settled record beat a running one", () => {
		const running = record({ status: "running" });
		const settled = record({ status: "exited", exitCode: 0, finishedAt: 200 });
		expect(mergeRecords(running, settled).status).toBe("exited");
		expect(mergeRecords(settled, running).status).toBe("exited");
	});

	test("mergeRecords lets the preferred session win a same-class tie", () => {
		const a = record({ sessionId: "a", startedAt: 100 });
		const b = record({ sessionId: "b", startedAt: 999 });
		expect(mergeRecords(a, b, "a").sessionId).toBe("a");
	});
});

describe("settleGone", () => {
	const options = { isAlive: () => false, tokenMatches: () => true, now: 999 };

	test("leaves a live process running", () => {
		const settled = settleGone(record(), { ...options, isAlive: () => true });
		expect(settled.status).toBe("running");
		expect(settled.finishedAt).toBeNull();
	});

	test("marks a gone process unknown without an exit code", () => {
		const settled = settleGone(record(), options);
		expect(settled.status).toBe("unknown");
		expect(settled.finishedAt).toBe(999);
	});

	test("recovers a zero code as exited and a non-zero as failed", () => {
		expect(settleGone(record(), { ...options, readExitCode: () => 0 })).toMatchObject({
			status: "exited",
			exitCode: 0,
		});
		expect(settleGone(record(), { ...options, readExitCode: () => 3 })).toMatchObject({
			status: "failed",
			exitCode: 3,
		});
	});

	test("a mismatched start token stays unknown and is never signalled", () => {
		const settled = settleGone(record(), { ...options, isAlive: () => true, tokenMatches: () => false });
		expect(settled.status).toBe("unknown");
	});

	test("leaves a finished record untouched", () => {
		const finished = record({ status: "exited", exitCode: 0, finishedAt: 50 });
		expect(settleGone(finished, options)).toBe(finished);
	});
});

describe("planReconcile", () => {
	test("marks a running job with a dead pid as unknown", () => {
		const { jobs, orphans } = planReconcile([record()], () => false, 999);
		expect(jobs[0].status).toBe("unknown");
		expect(jobs[0].finishedAt).toBe(999);
		expect(orphans).toHaveLength(0);
	});

	test("reaps a live, non-detached leftover", () => {
		const { jobs, orphans } = planReconcile([record()], () => true, 999);
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
		expect(jobs[0].status).toBe("running");
	});

	test("reattaches a live detached job", () => {
		const { orphans } = planReconcile([record({ detached: true })], () => true, 999);
		expect(orphans).toHaveLength(0);
	});

	test("leaves finished jobs untouched", () => {
		const finished = record({ status: "exited", exitCode: 0, finishedAt: 50 });
		const { jobs } = planReconcile([finished], () => true, 999);
		expect(jobs[0]).toEqual(finished);
	});

	test("keeps a live non-detached job owned by another live session", () => {
		const { jobs, orphans } = planReconcile([record({ sessionId: "peer" })], () => true, 999, {
			isOwnerAlive: (id) => id === "peer",
			currentSessionId: "me",
		});
		expect(orphans).toHaveLength(0);
		expect(jobs[0].status).toBe("running");
	});

	test("reaps a live non-detached job whose owner is dead", () => {
		const { orphans } = planReconcile([record({ sessionId: "peer" })], () => true, 999, {
			isOwnerAlive: () => false,
			currentSessionId: "me",
		});
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
	});

	test("reaps a live non-detached leftover from the current session", () => {
		const { orphans } = planReconcile([record({ sessionId: "me" })], () => true, 999, {
			isOwnerAlive: () => true,
			currentSessionId: "me",
		});
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
	});
});

describe("job reservations", () => {
	test("reserveId starts above the taken ids and reserves the result", () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		expect(reserveId(dir, ["j1", "j4"])).toBe("j5");
		expect(listReservedIds(dir)).toContain("j5");
	});

	test("reserveId hands out distinct ids on repeated calls without a registry update", () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const a = reserveId(dir, []);
		const b = reserveId(dir, []);
		// The second call sees the first reservation, so a stale read cannot collide.
		expect(a).not.toBe(b);
		expect(listReservedIds(dir).sort()).toEqual([a, b].sort());
	});

	test("reserveId honours a floor from a stored counter", () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		expect(reserveId(dir, ["j1"], 10)).toBe("j10");
	});

	test("releaseReservation removes the file and tolerates a missing one", () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const id = reserveId(dir, []);
		releaseReservation(dir, id);
		expect(listReservedIds(dir)).toEqual([]);
		expect(() => releaseReservation(dir, id)).not.toThrow();
	});

	test("pruneReservations drops committed ids and keeps the rest", () => {
		const dir = temps.track(tempDir("pi-jobs-reserve-"));
		const committed = reserveId(dir, []);
		const pending = reserveId(dir, []);
		pruneReservations(dir, [committed]);
		expect(listReservedIds(dir)).toEqual([pending]);
	});
});

describe("job session markers", () => {
	test("sessionMarkerPath is stable per session and differs across sessions", () => {
		expect(sessionMarkerPath("/dir", "s1")).toBe(sessionMarkerPath("/dir", "s1"));
		expect(sessionMarkerPath("/dir", "s1")).not.toBe(sessionMarkerPath("/dir", "s2"));
	});

	test("sessionMarkerPath hashes the id so it cannot escape the directory", () => {
		const path = sessionMarkerPath("/dir", "../../evil");
		expect(path.startsWith(join("/dir", "session-"))).toBe(true);
		expect(path).not.toContain("..");
	});

	test("touch/read/remove round-trips through disk", () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "s1", 1234, 500);
		expect(readSessionMarker(dir, "s1")).toEqual({ sessionId: "s1", pid: 1234, updatedAt: 500 });
		removeSessionMarker(dir, "s1");
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
		expect(() => removeSessionMarker(dir, "s1")).not.toThrow();
	});

	test("a missing marker is undefined", () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
	});

	test("a malformed marker is undefined", () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		writeFileSync(sessionMarkerPath(dir, "s1"), JSON.stringify({ sessionId: "s1", pid: "x" }), "utf-8");
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
	});

	test("a missing marker is dead", () => {
		expect(isSessionAlive(undefined, 1000, 100, () => true)).toBe(false);
	});

	test("a dead pid is dead even when fresh", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 1000 }, 1000, 100, () => false)).toBe(false);
	});

	test("a stale heartbeat is dead", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 800 }, 1000, 100, () => true)).toBe(false);
	});

	test("a fresh heartbeat with a live pid is alive", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 42, updatedAt: 950 }, 1000, 100, () => true)).toBe(true);
	});

	test("a non-positive pid falls back to the timestamp", () => {
		expect(isSessionAlive({ sessionId: "s1", pid: 0, updatedAt: 950 }, 1000, 100, () => false)).toBe(true);
	});

	test("listSessionMarkers lists every valid marker", () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "s1", 1, 100);
		touchSessionMarker(dir, "s2", 2, 100);
		expect(
			listSessionMarkers(dir)
				.map((marker) => marker.sessionId)
				.sort(),
		).toEqual(["s1", "s2"]);
	});

	test("pruneSessionMarkers prunes dead and stale markers, keeping live ones", () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "live", 10, 1000);
		touchSessionMarker(dir, "deadpid", 20, 1000);
		touchSessionMarker(dir, "stale", 30, 100);
		pruneSessionMarkers(dir, 1000, 100, (pid) => pid !== 20);
		expect(listSessionMarkers(dir).map((marker) => marker.sessionId)).toEqual(["live"]);
	});
});

describe("job status files", () => {
	test("withExitTrap is a no-op on Windows", () => {
		expect(withExitTrap("bun test", true)).toBe("bun test");
	});

	test("withExitTrap prepends an EXIT trap on POSIX and keeps the command intact", () => {
		const program = withExitTrap("bun test", false);
		expect(program).toContain("trap ");
		expect(program).toContain("EXIT");
		expect(program.endsWith("bun test")).toBe(true);
	});

	test("withExitTrap redirects a detached job's own output to the log file when asked", () => {
		const program = withExitTrap("bun test", false, true);
		expect(program.startsWith(`exec >> "$${LOG_ENV}" 2>&1\n`)).toBe(true);
		expect(program.endsWith("bun test")).toBe(true);
		expect(withExitTrap("bun test", false)).not.toContain("exec >>");
		expect(withExitTrap("bun test", true, true)).toBe("bun test");
	});

	test("readExitStatus reads a plain integer, tolerating surrounding whitespace", () => {
		const path = join(statusDir(), "j1.status");
		writeFileSync(path, "3\n", "utf-8");
		expect(readExitStatus(path)).toBe(3);
	});

	test("readExitStatus returns 0 for a zero code", () => {
		const path = join(statusDir(), "j1.status");
		writeFileSync(path, "0", "utf-8");
		expect(readExitStatus(path)).toBe(0);
	});

	test("readExitStatus returns undefined for a missing, empty, or malformed file", () => {
		const dir = statusDir();
		expect(readExitStatus(join(dir, "missing.status"))).toBeUndefined();
		expect(readExitStatus(undefined)).toBeUndefined();
		const empty = join(dir, "empty.status");
		writeFileSync(empty, "", "utf-8");
		expect(readExitStatus(empty)).toBeUndefined();
		const bad = join(dir, "bad.status");
		writeFileSync(bad, "boom", "utf-8");
		expect(readExitStatus(bad)).toBeUndefined();
	});

	// The EXIT trap is shell semantics, so this is the one place the suite runs a
	// real shell. It is deterministic (fixed commands and exit codes) and skipped
	// on Windows, where the trap is a no-op.
	const realShell = process.platform !== "win32";

	/**
	 * How long a real shell gets to exit before the test says it did not.
	 *
	 * A spawn can be starved for seconds while four test files run at once — the hazard
	 * AGENTS.md names for `--parallel`, and the reason CI runs the suite serially — so the
	 * wait is bounded here and reports that, instead of dying on the runner's own 30 s
	 * timeout with a test name and no reason.
	 */
	const SHELL_EXIT_MS = 10_000;
	/** How long the trap's write gets to land: it runs as the shell exits, past `close`. */
	const STATUS_LAND_MS = 2_000;

	/** Spawn `command` through a real shell with the status trap and wait for exit. */
	async function run(command: string, statusPath: string): Promise<void> {
		let closed = false;
		let failure: Error | undefined;
		const child = spawn(withExitTrap(command, false), {
			shell: true,
			stdio: "ignore",
			env: { ...process.env, [STATUS_ENV]: statusPath },
		});
		child.on("close", () => {
			closed = true;
		});
		child.on("error", (error) => {
			failure = error;
			closed = true;
		});
		try {
			// `waitFor` is this suite's one clock; a spawn that never closes names itself
			// here rather than at the runner's own timeout, which says only the test's name.
			await waitFor(() => closed, SHELL_EXIT_MS);
		} catch {
			child.kill("SIGKILL");
			throw new Error(`the shell did not exit within ${SHELL_EXIT_MS}ms`);
		}
		if (failure) throw failure;
	}

	/**
	 * The code the trap recorded, once its write lands.
	 *
	 * The trap writes the file as the shell exits, so the write and the child's `close`
	 * event race: read once and a slow machine reads nothing. `undefined` afterwards means
	 * the trap never wrote, which is what the `exec` case asserts on its own.
	 */
	async function exitStatusOf(statusPath: string): Promise<number | undefined> {
		try {
			await waitFor(() => readExitStatus(statusPath) !== undefined, STATUS_LAND_MS);
		} catch {
			return undefined;
		}
		return readExitStatus(statusPath);
	}

	test.skipIf(!realShell)("the EXIT trap records a non-zero exit code", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("exit 7", statusPath);
		expect(await exitStatusOf(statusPath)).toBe(7);
	});

	test.skipIf(!realShell)("the EXIT trap records zero for a normal command", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("printf hello", statusPath);
		expect(await exitStatusOf(statusPath)).toBe(0);
	});

	test.skipIf(!realShell)("an exec that replaces the shell bypasses the trap", async () => {
		const statusPath = join(statusDir(), "j1.status");
		await run("exec true", statusPath);
		expect(readExitStatus(statusPath)).toBeUndefined();
	});
});

describe("job store", () => {
	test("persist writes only this session's records", () => {
		const dir = temps.track(tempDir("pi-jobs-store-"));
		const store = createJobStore(dir);
		store.setSession("me");
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "peer",
			counter: 3,
			jobs: [record({ id: "j9", sessionId: "peer" })],
		});
		store.persist([job({ id: "j1", sessionId: "me", seen: true }), job({ id: "j2", sessionId: "peer" })]);
		const files = Object.fromEntries(loadRegistries(dir).files.map((file) => [file.sessionId, file]));
		expect(files.me.jobs.map((entry) => entry.id)).toEqual(["j1"]);
		expect(files.me.jobs[0].seen).toBe(true);
		expect(files.peer.jobs.map((entry) => entry.id)).toEqual(["j9"]);
	});

	test("safeLogPath accepts only this job's file in the directory", () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeLogPath(record({ id: "j1", logPath: "/tmp/pi-jobs-store/j1.log" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.log")),
		);
		expect(store.safeLogPath(record({ id: "j1", logPath: "/tmp/elsewhere/j1.log" }))).toBeUndefined();
	});

	test("safeStatusPath accepts only a status file in the directory", () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeStatusPath(record({ id: "j1", statusPath: "/tmp/pi-jobs-store/j1.status" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.status")),
		);
		expect(store.safeStatusPath(record({ id: "j1", statusPath: "/tmp/elsewhere/j1.status" }))).toBeUndefined();
		expect(store.safeStatusPath(record({ id: "j1", statusPath: null }))).toBeUndefined();
	});

	test("safeRotatedLogPath derives the previous segment and refuses a traversing id", () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeRotatedLogPath(record({ id: "j1" }))).toBe(resolve(join("/tmp/pi-jobs-store", "j1.log.1")));
		expect(store.safeRotatedLogPath(record({ id: "../../escape" }))).toBeUndefined();
	});
});

describe("job log tails", () => {
	test("a missing path yields an empty tail", () => {
		const dir = temps.track(tempDir("pi-jobs-missing-"));
		expect(readLogTail(join(dir, "log"), 10)).toEqual({
			lines: [],
			truncated: false,
			more: false,
		});
	});

	test("tails the requested lines and sanitizes escapes", () => {
		const dir = temps.track(tempDir("pi-jobs-logs-"));
		const path = join(dir, "j1.log");
		writeFileSync(path, "\u001b[31mred\u001b[0m\nsecond\nthird\n");
		const tail = readLogTail(path, 2);
		expect(tail.lines).toEqual(["second", "third"]);
		expect(tail.truncated).toBe(false);
		expect(tail.more).toBe(true);
	});

	test("flags that earlier lines exist beyond the returned window", () => {
		const dir = temps.track(tempDir("pi-jobs-logs-"));
		const path = join(dir, "j1.log");
		writeFileSync(path, "a\nb\nc\nd\ne\n");
		const tail = readLogTail(path, 2);
		expect(tail.lines).toEqual(["d", "e"]);
		expect(tail.more).toBe(true);
	});
});

describe("job waiters", () => {
	test("resolves every waiter for an id exactly once", () => {
		const waiters = createWaiters();
		const seen: string[] = [];
		waiters.add("j1", () => seen.push("a"));
		waiters.add("j1", () => seen.push("b"));
		waiters.resolve("j1");
		waiters.resolve("j1");
		expect(seen.sort()).toEqual(["a", "b"]);
	});

	test("a removed waiter is not woken", () => {
		const waiters = createWaiters();
		let fired = 0;
		const remove = waiters.add("j1", () => fired++);
		remove();
		waiters.resolve("j1");
		expect(fired).toBe(0);
	});

	test("resolveAll wakes every id", () => {
		const waiters = createWaiters();
		let fired = 0;
		waiters.add("j1", () => fired++);
		waiters.add("j2", () => fired++);
		waiters.resolveAll();
		expect(fired).toBe(2);
	});
});

describe("job runtime — start", () => {
	test("spawns, records a running job, and assigns ids", () => {
		const h = suite.makeHarness();
		start(h);
		const entry = h.runtime.get("j1");
		expect(entry?.status).toBe("running");
		expect(entry?.pid).toBe(h.children[0].pid);
		expect(h.children[0].command).toContain("sleep 10");
		expect(h.runtime.runningCount()).toBe(1);
	});

	test("creates the registry directory before reserving an id", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		// A first job in a project whose registry directory does not exist yet
		// must still be able to reserve its id (`O_EXCL` lock inside that dir).
		rmSync(h.dir, { recursive: true, force: true });
		const entry = h.runtime.start({ command: "sleep 10" }, ctx);
		expect(existsSync(h.dir)).toBe(true);
		expect(entry.id).toBe("j1");
	});

	test("rejects a start when jobs are disabled", () => {
		const h = suite.makeHarness({ config: { enabled: false } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.start({ command: "true" }, ctx)).toThrow("jobs are disabled");
	});

	test("uses the label when given and the command otherwise", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(h.runtime.start({ command: "bun test", label: "tests" }, ctx).label).toBe("tests");
		expect(h.runtime.start({ command: "bun build" }, ctx).label).toBe("bun build");
	});

	test("streams output into the log file and caches the last line", async () => {
		const h = suite.makeHarness();
		start(h);
		const entry = h.runtime.get("j1")!;
		h.children[0].write("one\n two \n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "two");
		await waitFor(() => readLog(entry.logPath).includes("one"));
		expect(h.runtime.get("j1")?.lastLine).toBe("two");
	});

	test("sanitizes ANSI in the cached last line", async () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].write("\u001b[31mred\u001b[0m\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "red");
	});

	test("sanitizes a label with escape sequences", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const entry = h.runtime.start({ command: "true", label: "\u001b[31mred\u001b[0m" }, ctx);
		expect(entry.label).toBe("red");
	});

	test("records a status path so a POSIX job can recover its exit code", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const entry = h.runtime.start({ command: "true" }, ctx);
		if (process.platform === "win32") expect(entry.statusPath).toBeNull();
		else expect(entry.statusPath).toContain(`${entry.id}.status`);
	});

	test("releases the reserved id when the spawn itself fails", () => {
		const dir = temps.track(tempDir("pi-jobs-spawn-"));
		const runtime = runtimeWithFailedSpawn(dir);
		const { ctx } = makeCtx();
		runtime.load(ctx);
		expect(() => runtime.start({ command: "true" }, ctx)).toThrow("spawn failed");
		expect(listReservedIds(dir)).toEqual([]);
		expect(runtime.list()).toEqual([]);
	});

	test("auto-kills a job after its timeout", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1", timeoutMs: 10 }, ctx);
		const pid = h.children[0].pid;
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGTERM"));
	});

	test("escalates the timeout kill to SIGKILL after the grace period", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1", timeoutMs: 10 }, ctx);
		const pid = h.children[0].pid;
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL"));
		expect(h.kills.find((kill) => kill.signal === "SIGKILL")?.force).toBe(true);
	});

	test("does not kill a job that finishes before its timeout", async () => {
		const h = suite.makeHarness();
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
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(0);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
		expect(h.runtime.runningCount()).toBe(0);
	});

	test("a non-zero exit becomes failed", () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(2);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(2);
	});

	test("a signal close becomes killed", () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(null, "SIGTERM");
		expect(h.runtime.get("j1")?.status).toBe("killed");
		expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
	});

	test("a spawn error settles the job as failed", () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].fail("boom");
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(1);
	});

	test("notifies once when a job fails", () => {
		const h = suite.makeHarness();
		const { ctx, notifications } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1", label: "build" }, ctx);
		h.children[0].close(2);
		expect(notifications).toEqual(["Job j1 failed: build (exit 2)"]);
	});

	test("does not notify on a clean exit", () => {
		const h = suite.makeHarness();
		const { ctx, notifications } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		h.children[0].close(0);
		expect(notifications).toEqual([]);
	});

	test("reports a completion to onComplete exactly once", () => {
		const h = suite.makeHarness();
		const seen: Array<{ id: string; status: string; exitCode: number | null }> = [];
		h.runtime.onComplete = (entry) => seen.push({ id: entry.id, status: entry.status, exitCode: entry.exitCode });
		start(h);
		h.children[0].close(2);
		expect(seen).toEqual([{ id: "j1", status: "failed", exitCode: 2 }]);
	});
});

describe("job runtime — kill", () => {
	test("sends SIGTERM to the process group", () => {
		const h = suite.makeHarness();
		start(h);
		const pid = h.children[0].pid;
		h.runtime.kill("j1");
		expect(h.kills).toEqual([{ pid, signal: "SIGTERM", force: false }]);
	});

	test("SIGKILL forces and escalates nothing", () => {
		const h = suite.makeHarness();
		start(h);
		const pid = h.children[0].pid;
		h.runtime.kill("j1", "SIGKILL");
		expect(h.kills[0]).toMatchObject({ pid, signal: "SIGKILL", force: true });
	});

	test("killing a finished job is a no-op", () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(0);
		h.runtime.kill("j1");
		expect(h.kills).toHaveLength(0);
	});

	test("escalates a SIGTERM to SIGKILL after the grace period", async () => {
		const h = suite.makeHarness();
		start(h);
		const pid = h.children[0].pid;
		h.runtime.kill("j1", "SIGTERM");
		await waitFor(() => h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL"));
		expect(h.kills.at(-1)).toMatchObject({ pid, signal: "SIGKILL", force: true });
	});

	test("settles a running record with no pid as unknown", () => {
		const h = suite.makeHarness();
		save(h, "old", [record({ pid: null })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.kill("j1")).toMatchObject({ status: "unknown" });
		expect(h.kills).toHaveLength(0);
	});

	test("reconciles a reattached job after the kill grace period", async () => {
		const h = suite.makeHarness();
		save(h, "old", [record({ label: "server", command: "dev", detached: true })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");

		h.runtime.kill("j1", "SIGTERM");
		await waitFor(() => h.runtime.get("j1")?.status === "killed");
		expect(h.runtime.get("j1")?.signal).toBe("SIGTERM");
	});
});

describe("job runtime — send", () => {
	/** Load the runtime and start a job that opted into a stdin pipe. */
	function startWithStdin(h: Harness): Job {
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		return h.runtime.start({ command: "cat", stdin: true }, ctx);
	}

	test("opens a stdin pipe only when the job asks for one", () => {
		const h = suite.makeHarness();
		start(h);
		expect(h.children[0].options?.stdin).toBe(false);
		expect(h.runtime.get("j1")?.stdin).toBe(false);

		const piped = suite.makeHarness();
		const entry = startWithStdin(piped);
		expect(piped.children[0].options?.stdin).toBe(true);
		expect(entry.stdin).toBe(true);
	});

	test("writes a line and adds the newline itself", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		const result = h.runtime.send("j1", { input: "hello" });
		expect(result.sent).toBe(5);
		expect(result.closed).toBe(false);
		expect(h.children[0].stdinSink?.text).toBe("hello\n");
	});

	test("writes verbatim when newline is false", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		h.runtime.send("j1", { input: "y", newline: false });
		expect(h.children[0].stdinSink?.text).toBe("y");
	});

	test("ends stdin on eof and refuses a later write", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		const result = h.runtime.send("j1", { input: "bye", eof: true });
		expect(result.closed).toBe(true);
		expect(h.children[0].stdinSink?.text).toBe("bye\n");
		expect(h.children[0].stdinSink?.ended).toBe(true);
		expect(() => h.runtime.send("j1", { input: "again" })).toThrow("closed its stdin");
	});

	test("closes stdin without writing when eof is all it is given", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		h.runtime.send("j1", { eof: true });
		expect(h.children[0].stdinSink?.text).toBe("");
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	test("refuses a job started without stdin", () => {
		const h = suite.makeHarness();
		start(h);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("was not started with stdin");
	});

	test("refuses an unknown or finished job", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow('no job "j9"');
		h.children[0].close(0);
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("is exited; stdin is closed");
	});

	test("refuses a running job whose pipe belongs to another session", () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [record({ id: "j9", label: "peer", sessionId: "peer", detached: true, stdin: true })], 10);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(() => h.runtime.send("j9", { input: "x" })).toThrow("belongs to the session that started it");
	});

	test("reports a closed pipe when the child closed its end", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		const sink = h.children[0].stdinSink;
		if (!sink) throw new Error("expected a stdin pipe");
		sink.failWith = new Error("EPIPE");
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
		// The pipe is dropped, so the next call says the same thing without writing.
		expect(() => h.runtime.send("j1", { input: "x" })).toThrow("closed its stdin");
	});

	test("ends stdin when the job's process closes", () => {
		const h = suite.makeHarness();
		startWithStdin(h);
		h.children[0].close(0);
		expect(h.children[0].stdinSink?.ended).toBe(true);
	});

	// Detached stdin is POSIX-only: Windows refuses the detach before the pipe is
	// considered, so these pin the host instead of the one the suite runs on.
	test("rejects stdin on a detached job", () => {
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.start({ command: "cat", stdin: true, detached: true }, ctx)).toThrow("cannot take stdin");
	});

	test("rejects stdin when detached is the configured default", () => {
		const h = suite.makeHarness({ isWindows: () => false, config: { detachedByDefault: true } });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		expect(() => h.runtime.start({ command: "cat", stdin: true }, ctx)).toThrow("cannot take stdin");
	});
});

describe("job runtime — Windows", () => {
	/** A harness that believes it is Windows, whichever host is running the test. */
	const windows = (options: Parameters<typeof suite.makeHarness>[0] = {}) =>
		suite.makeHarness({ ...options, isWindows: () => true });

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

		const entry = h.runtime.start({ command: "true" }, ctx);

		expect(entry.detached).toBe(false);
		expect(entry.statusPath).toBeNull();
	});

	test("starts an attached job when the call asks for one", () => {
		const h = windows();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		const entry = h.runtime.start({ command: "true", detached: false }, ctx);

		expect(entry.detached).toBe(false);
		// Attached jobs keep a parent-owned log stream and their exit code from the
		// child's own `close`, which is the whole Windows story.
		expect(readLog(entry.logPath)).toBe("");
	});

	test("still detaches on POSIX, so the refusal cannot leak across platforms", () => {
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);

		expect(h.runtime.start({ command: "true", detached: true }, ctx).detached).toBe(true);
	});
});

describe("job runtime — logs", () => {
	test("returns a sanitized tail", async () => {
		const h = suite.makeHarness();
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
		const h = suite.makeHarness();
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
		const h = suite.makeHarness({ config: { maxLogLines: 2 } });
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
		const h = suite.makeHarness({ config: { maxLogLines: 2 } });
		start(h);
		h.children[0].write("a\nb\nc\nd\ne\n");
		await waitFor(() => h.runtime.get("j1")?.lastLine === "e");
		await waitFor(() => readLog(h.runtime.get("j1")!.logPath).includes("e"));
		expect(h.runtime.logs("j1")?.more).toBe(true);
	});
});

describe("job runtime — wait", () => {
	test("resolves when the job finishes", async () => {
		const h = suite.makeHarness();
		start(h);
		const promise = h.runtime.wait("j1", 1000, undefined);
		h.children[0].close(0);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
		expect(result?.job.status).toBe("exited");
	});

	test("returns immediately for a finished job", async () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(0);
		const result = await h.runtime.wait("j1", 10_000, undefined);
		expect(result).toMatchObject({ timedOut: false, cancelled: false });
	});

	test("returns undefined for an unknown job", async () => {
		const h = suite.makeHarness();
		h.runtime.load(makeCtx().ctx);
		expect(await h.runtime.wait("j9", 0, undefined)).toBeUndefined();
	});

	test("times out while the job keeps running", async () => {
		const h = suite.makeHarness();
		start(h);
		const result = await h.runtime.wait("j1", 0, undefined);
		expect(result?.timedOut).toBe(true);
		expect(h.runtime.get("j1")?.status).toBe("running");
	});

	test("cancels on abort without killing the job", async () => {
		const h = suite.makeHarness();
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
		const h = suite.makeHarness();
		h.dead.add(888);
		save(h, "old", [record({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "0", "utf-8");
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
	});

	test("recovers a non-zero exit code as failed", () => {
		const h = suite.makeHarness();
		h.dead.add(888);
		save(h, "old", [record({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "3", "utf-8");
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(3);
	});

	test("refuses to signal a pid whose start token changed", () => {
		const h = suite.makeHarness({ startToken: () => "new" });
		save(h, "old", [record({ startToken: "old" })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.kills).toHaveLength(0);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("adopts a dead session's records and deletes its file", () => {
		const h = suite.makeHarness();
		save(h, "old", [record({ detached: true, status: "exited", exitCode: 0, finishedAt: 5, sessionId: "old" })], 2);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.get("j1")?.sessionId).toBe("me");
		expect(h.runtime.get("j1")?.status).toBe("exited");
		const files = loadRegistries(h.dir).files.map((file) => file.sessionId);
		expect(files).not.toContain("old");
		expect(persistedIds(h)).toContain("j1");
	});

	test("polls a reattached detached job when its pid disappears", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		save(h, "old", [record({ label: "server", command: "dev", detached: true })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("wakes for a reattached wake job that finishes", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const fired: string[] = [];
		h.runtime.onFinish = (entry) => fired.push(entry.id);
		save(h, "old", [record({ label: "server", command: "dev", detached: true, wake: true })], 2);
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
		expect(fired).toEqual(["j1"]);
	});

	test("reports a reattached job observed gone", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (entry) => seen.push(`${entry.id}:${entry.status}`);
		save(h, "old", [record({ label: "server", command: "dev", detached: true })], 2);
		h.runtime.load(makeCtx().ctx);
		h.dead.add(777);
		await settle(60);
		expect(seen).toEqual(["j1:unknown"]);
	});

	test("does not report a reattached job with no pid to judge", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (entry) => seen.push(entry.id);
		save(h, "old", [record({ label: "server", command: "dev", detached: true, pid: null })], 2);
		h.runtime.load(makeCtx().ctx);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("running");
		expect(seen).toEqual([]);
	});
});

describe("job runtime — pending, clear, status", () => {
	test("pendingCompletions peeks and markReported marks", () => {
		const h = suite.makeHarness();
		start(h);
		h.children[0].close(0);
		expect(h.runtime.pendingCompletions().map((entry) => entry.id)).toEqual(["j1"]);
		expect(h.runtime.pendingCompletions().map((entry) => entry.id)).toEqual(["j1"]);
		h.runtime.markReported(["j1"]);
		expect(h.runtime.pendingCompletions()).toEqual([]);
	});

	test("clear removes finished jobs but refuses running ones", () => {
		const h = suite.makeHarness();
		start(h);
		expect(h.runtime.clear("j1", false).refused).toContain("still running");
		h.children[0].close(0);
		expect(h.runtime.clear(undefined, false).cleared).toBe(1);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("clear refuses an unknown id", () => {
		const h = suite.makeHarness();
		h.runtime.load(makeCtx().ctx);
		expect(h.runtime.clear("j9", false)).toEqual({ cleared: 0, refused: 'no job "j9".' });
	});

	test("clear all resolves a pending wait", async () => {
		const h = suite.makeHarness();
		start(h);
		const promise = h.runtime.wait("j1", 10_000, undefined);
		h.runtime.clear(undefined, true);
		const result = await promise;
		expect(result?.timedOut).toBe(false);
	});

	test("clear with all force-removes running jobs", () => {
		const h = suite.makeHarness();
		start(h);
		const pid = h.children[0].pid;
		expect(h.runtime.clear(undefined, true).cleared).toBe(1);
		expect(h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL")).toBe(true);
		expect(h.runtime.get("j1")).toBeUndefined();
	});

	test("status chip shows the running count and clears at zero", () => {
		const h = suite.makeHarness();
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
		const h = suite.makeHarness();
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
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [record({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		// Visible, but owned by the peer: the row is tagged and the record cannot be
		// cleared here, while its id stays reserved.
		expect(h.runtime.list().map((entry) => entry.id)).toContain("j9");
		expect(h.runtime.list().find((entry) => entry.id === "j9")?.sessionId).toBe("peer");
		expect(h.runtime.sessionId).toBe("me");
		expect(h.runtime.get("j9")?.status).toBe("running");
		expect(h.runtime.start({ command: "mine" }, ctx).id).toBe("j10");
	});

	test("clear refuses another session's finished job", () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(
			h,
			"peer",
			[
				record({
					id: "j9",
					label: "peer",
					sessionId: "peer",
					detached: true,
					status: "exited",
					exitCode: 0,
					pid: null,
					finishedAt: 5,
				}),
			],
			10,
		);
		h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.clear("j9", false).refused).toContain("another live session");
	});

	test("does not count a live peer's running job in the chip", () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [record({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("ignores a live peer's unreported failure in the chip", () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(
			h,
			"peer",
			[record({ label: "peer", sessionId: "peer", status: "failed", exitCode: 1, pid: null, finishedAt: 5 })],
			2,
		);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs-failure")).toBe(false);
	});

	test("re-asserts the chip on the repaint clock after an external clear", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const { ctx, statuses } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 10" }, ctx);
		expect(statuses.get("jobs")).toContain("1");
		// Simulate something clearing the status while the job keeps running.
		statuses.delete("jobs");
		await settle(60);
		expect(statuses.get("jobs")).toContain("1");
	});

	test("shutdown kills non-detached jobs, keeps detached ones, and removes the marker", async () => {
		// Detached jobs exist on POSIX only; pin the host rather than the runner's.
		const h = suite.makeHarness({ isWindows: () => false });
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "a" }, ctx);
		h.runtime.start({ command: "b", detached: true }, ctx);
		const detachedPid = h.children[1].pid;
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === h.children[0].pid)).toBe(true);
		expect(h.kills.some((kill) => kill.pid === detachedPid)).toBe(false);
		expect(readSessionMarker(h.dir, ctx.sessionManager.getSessionId())).toBeUndefined();
	});

	test("shutdown escalates a job that ignores SIGTERM", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "stubborn" }, ctx);
		const pid = h.children[0].pid;
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === pid && kill.signal === "SIGKILL")).toBe(true);
	});

	test("shutdown leaves a live peer's job running", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [record({ label: "peer", sessionId: "peer", detached: false })], 2);
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === 777)).toBe(false);
	});

	test("persist keeps a peer session's file intact", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ sessionId: "me" });
		h.runtime.load(ctx);
		save(h, "peer", [record({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const entry = h.runtime.start({ command: "mine" }, ctx);
		expect(entry.id).toBe("j10");
		expect(persistedIds(h)).toContain("j9");
		expect(persistedIds(h)).toContain("j10");
		expect(loadRegistries(h.dir).files.some((file) => file.sessionId === "peer")).toBe(true);
	});
});

describe("job runtime — detached output and registry root", () => {
	const posix = process.platform !== "win32";

	test.skipIf(!posix)("gives a detached job its own output and unrefs it", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "serve", detached: true }, ctx);
		const child = h.children[0];
		expect(child.options?.detachOutput).toBe(true);
		expect(child.unrefed).toBe(true);
		expect(String(child.options?.env?.[LOG_ENV])).toContain("j1.log");
	});

	test("keeps the parent pipe for a non-detached job", () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		h.runtime.start({ command: "sleep 1" }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(false);
		expect(h.children[0].unrefed).toBe(false);
	});

	test("anchors the registry to the session cwd, not a worktree root set later", async () => {
		await withAgentDir(async (agentDir) => {
			const worktree = temps.track(tempDir("pi-jobs-wt-"));
			const h = suite.makeHarness({ config: { registryDir: undefined } });
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

/**
 * How long a rotation case waits for a write to reach the log.
 *
 * The write reaches the file through the child's pipe, asynchronously; 200 ms was
 * tight enough to fail once in a full `--parallel` run on a loaded machine, while
 * the budget only bounds a genuine failure. It matches `waitFor`'s own default.
 */
const ROTATE_BUDGET_MS = 2000;

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
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		// Each write waits for the file, so the stream's byte count matches the file
		// and the third line deterministically crosses the 8-byte cap.
		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		// The rename lands before the reopened stream flushes its queued chunk, so
		// wait for both halves rather than asserting on an empty live segment.
		await waitFor(() => readLog(rotated) === "aaaa\nbbbb\n" && readLog(logPath) === "cccc\n", ROTATE_BUDGET_MS);
	});

	test("keeps one previous segment and replaces it on the next rotation", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		for (const line of ["aaaa", "bbbb", "cccc", "dddd", "eeee"]) {
			h.children[0].write(`${line}\n`);
			await waitFor(() => readLog(logPath).includes(line) || readLog(rotated).includes(line), ROTATE_BUDGET_MS);
		}

		// Two rotations by the fifth line: the first pair moves to `.1`, the second
		// pair replaces it, and the newest line starts the live segment again.
		await waitFor(() => readLog(rotated) === "cccc\ndddd\n" && readLog(logPath) === "eeee\n", ROTATE_BUDGET_MS);
		expect(existsSync(rotated)).toBe(true);
		expect(existsSync(`${rotated}.1`)).toBe(false);
		// The oldest line was rotated out of the only previous segment.
		expect(readLog(rotated)).not.toContain("aaaa");
		expect(readLog(logPath)).toContain("eeee");
	});

	test("drains a rotation backlog through the cap instead of one oversized segment", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);

		// The first chunk starts a rotation; the next two arrive while it is in
		// flight. They are replayed through the cap check, so the new segment is
		// bounded and the order across the two segments is unchanged.
		h.children[0].write("bbbb\n");
		h.children[0].write("cccc\n");
		h.children[0].write("dddd\n");
		await waitFor(() => existsSync(rotated) && readLog(logPath).includes("dddd"), ROTATE_BUDGET_MS);
		await settle(20);

		expect(readLog(rotated) + readLog(logPath)).toBe("aaaa\nbbbb\ncccc\ndddd\n");
		expect(readLog(logPath).length).toBeLessThanOrEqual(8 + "dddd\n".length);
	});

	test("logs reads across the rotated segment", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8, maxLogLines: 10 } });
		const logPath = startCapped(h);

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		await waitFor(() => readLog(logPath) === "cccc\n" && existsSync(join(h.dir, "j1.log.1")), ROTATE_BUDGET_MS);

		expect(h.runtime.logs("j1", 10)?.lines).toEqual(["aaaa", "bbbb", "cccc"]);
	});

	test("clear removes both segments", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);
		h.children[0].write("cccc\n");
		await waitFor(() => existsSync(rotated), ROTATE_BUDGET_MS);

		h.children[0].close(0);
		h.runtime.clear("j1", false);
		expect(existsSync(logPath)).toBe(false);
		expect(existsSync(rotated)).toBe(false);
	});

	test("a detached job writes its own log and is not rotated", () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		if (process.platform === "win32") return;
		const { ctx } = makeCtx();
		h.runtime.load(ctx);
		const entry = h.runtime.start({ command: "serve", detached: true }, ctx);
		expect(h.children[0].options?.detachOutput).toBe(true);

		// The parent holds no stream for it, so no chunk is seen and nothing rotates.
		h.children[0].write("aaaaaaaaaaaaaaaaaaaa\n");
		h.children[0].write("bbbbbbbbbbbbbbbbbbbb\n");
		expect(existsSync(join(h.dir, "j1.log.1"))).toBe(false);
		expect(entry.detached).toBe(true);
	});

	test("a finished job never leaves a reopened stream behind", async () => {
		const h = suite.makeHarness({ config: { maxLogBytes: 8 } });
		const logPath = startCapped(h);
		const rotated = join(h.dir, "j1.log.1");

		h.children[0].write("aaaa\n");
		await waitFor(() => readLog(logPath) === "aaaa\n", ROTATE_BUDGET_MS);
		h.children[0].write("bbbb\n");
		await waitFor(() => readLog(logPath) === "aaaa\nbbbb\n", ROTATE_BUDGET_MS);

		// The third line starts a rotation; the close arrives before the stream's own
		// `close`, so the pending callback must bail instead of renaming and reopening.
		h.children[0].write("cccc\n");
		h.children[0].close(0);
		await settle(20);

		expect(existsSync(rotated)).toBe(false);
		expect(readLog(logPath)).toBe("aaaa\nbbbb\n");
	});
});
