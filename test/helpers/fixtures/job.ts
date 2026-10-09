import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobsConfig } from "../../../extensions/job/config.ts";
import { DEFAULT_CONFIG } from "../../../extensions/job/config.ts";
import type { KillTreeFn, LivenessFn, SpawnFn, StartTokenFn } from "../../../extensions/job/process.ts";
import { createJobsRuntime, type JobsRuntime } from "../../../extensions/job/runtime.ts";
import { makeClock } from "../clock.ts";
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
	options: { script?: (child: JobChild) => void; config?: Partial<JobsConfig>; startToken?: StartTokenFn } = {},
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
