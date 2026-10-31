import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobsConfig } from "../../../extensions/job/config.ts";
import { DEFAULT_CONFIG } from "../../../extensions/job/config.ts";
import { loadRegistries, REGISTRY_VERSION, saveRegistry } from "../../../extensions/job/registry.ts";
import type { JobCall } from "../../../extensions/job/schema.ts";
import type { Job, JobRecord } from "../../../extensions/job/types.ts";
import type { KillTreeFn, LivenessFn, SpawnFn, StartTokenFn } from "../../../lib/spawn.ts";
import { createJobsRuntime, type JobsRuntime } from "../../../extensions/job/runtime.ts";
import { makeClock } from "../clock.ts";
import { tempDir } from "../env.ts";
import type { TempTracker } from "../git.ts";
import { makeJobSpawn, type JobChild } from "../process.ts";
import { fakeCtx as sharedFakeCtx, type FakeCtxResult } from "../context.ts";

export { makeJobSpawn as makeFakeSpawn, JobChild as FakeChild, waitFor } from "../process.ts";

export interface FakeCtx extends FakeCtxResult {
	/** Legacy alias for `notices` used by job tests. */
	notices: Array<{ message: string; kind?: string }>;
}

/** A minimal `ExtensionContext` for runtime and event handlers. */
export function makeCtx(options: { cwd?: string; mode?: string; sessionId?: string } = {}): FakeCtx {
	return sharedFakeCtx({
		mode: options.mode ?? "print",
		hasUI: false,
		cwd: options.cwd ?? "/tmp/jobs-work",
		sessionId: options.sessionId ?? "s1",
	});
}

export interface Harness {
	runtime: JobsRuntime;
	config: JobsConfig;
	dir: string;
	spawn: SpawnFn;
	children: JobChild[];
	kills: Array<{ pid: number; signal: NodeJS.Signals; force?: boolean }>;
	dead: Set<number>;
	cleanup: () => void;
}

/** Build a runtime wired to fake process primitives and a temp registry. */
export function makeHarness(
	options: {
		script?: (child: JobChild) => void;
		config?: Partial<JobsConfig>;
		startToken?: StartTokenFn;
		isWindows?: () => boolean;
		sleep?: (ms: number) => Promise<void>;
	} = {},
): Harness {
	const clock = makeClock(1000);
	const dir = mkdtempSync(join(tmpdir(), "pi-jobs-"));
	const config: JobsConfig = {
		...DEFAULT_CONFIG,
		registryDir: dir,
		killGraceMs: 5,
		repaintMs: 1_000_000,
		...options.config,
	};
	const { spawn, children } = makeJobSpawn(options.script);
	const kills: Harness["kills"] = [];
	const dead = new Set<number>();
	const killTree: KillTreeFn = (pid, signal, force) => {
		kills.push({ pid, signal, force });
		dead.add(pid);
	};
	const liveness: LivenessFn = (pid) => !dead.has(pid);
	const runtime = createJobsRuntime({
		spawn,
		killTree,
		liveness,
		now: () => clock.advance(10),
		config,
		startToken: options.startToken ?? (() => undefined),
		isWindows: options.isWindows,
		sleep: options.sleep,
	});

	return {
		runtime,
		config,
		dir,
		spawn,
		children,
		kills,
		dead,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Read a job's log file, or "" when absent. */
export function readLog(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

/**
 * A persisted job record for a suite that is about ownership or the registry.
 *
 * `sessionId` defaults to a peer's, which is what a fixture writes when it is not about
 * this session's own jobs. Named for the capability rather than `record`, so the one-file
 * suites that build their own keep their own; only a suite that shares one imports this.
 */
export function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
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

/** Persist a session's registry file in a harness directory. */
export function save(h: { dir: string }, sessionId: string, entries: JobRecord[], counter = entries.length + 1): void {
	saveRegistry(h.dir, { version: REGISTRY_VERSION, sessionId, counter, jobs: entries });
}

/** Every persisted record across all session files. */
export function persistedIds(h: { dir: string }): string[] {
	return loadRegistries(h.dir)
		.files.flatMap((file) => file.jobs)
		.map((entry) => entry.id)
		.sort();
}

/**
 * A per-suite harness factory whose `cleanup` removes every harness it made.
 * Each test file creates one and registers `afterEach(() => suite.cleanup())`,
 * so tests never need a `try/finally`.
 */
export interface HarnessSuite {
	makeHarness: (options?: Parameters<typeof makeHarness>[0]) => Harness;
	cleanup: () => void;
}

/** Build a suite-scoped harness factory. */
export function makeHarnessSuite(): HarnessSuite {
	const live: Harness[] = [];
	return {
		makeHarness: (options) => {
			const harness = makeHarness(options);
			live.push(harness);
			return harness;
		},
		cleanup: () => {
			for (const harness of live.splice(0)) harness.cleanup();
		},
	};
}

/** The in-memory shape the store persists. */
export function job(overrides: Partial<JobRecord> = {}): Job {
	return { ...jobRecord(overrides), owned: true };
}

/** Load a runtime and start one job on it, which most suites begin with. */
export async function startJob(h: Harness, command = "sleep 10"): Promise<void> {
	const { ctx } = makeCtx();
	await h.runtime.load(ctx);
	await h.runtime.start({ command }, ctx);
}

/** Narrow a normalized call to one action, or fail the test. */
export function asAction<A extends JobCall["action"]>(call: JobCall, action: A): Extract<JobCall, { action: A }> {
	if (call.action !== action) throw new Error(`expected ${action}, got ${call.action}`);
	return call as Extract<JobCall, { action: A }>;
}

/** A temp directory for a status file, registered with the caller's tracker. */
export function statusDir(temps: TempTracker): string {
	return temps.track(tempDir("pi-jobs-status-"));
}

/** A runtime whose spawn always fails, for the case that checks the reserved id is released. */
export function runtimeWithFailedSpawn(dir: string): JobsRuntime {
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
