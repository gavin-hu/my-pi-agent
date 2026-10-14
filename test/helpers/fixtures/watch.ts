import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type WatchConfig } from "../../../extensions/watch/config.ts";
import type { KillTreeFn, SpawnFn } from "../../../extensions/watch/process.ts";
import { createWatchRuntime, type WatchRuntime } from "../../../extensions/watch/runtime.ts";
import { makeClock, type Clock } from "../clock.ts";
import { fakeCtx as sharedFakeCtx, type FakeCtxResult } from "../context.ts";
import { makeJobSpawn, type JobChild } from "../process.ts";

export { makeJobSpawn as makeFakeSpawn, JobChild as FakeChild, waitFor } from "../process.ts";

export type FakeCtx = FakeCtxResult;

/** A minimal `ExtensionContext` for runtime and event handlers. */
export function makeCtx(options: { cwd?: string; mode?: string; sessionId?: string } = {}): FakeCtx {
	return sharedFakeCtx({
		mode: options.mode ?? "print",
		hasUI: false,
		cwd: options.cwd ?? "/tmp/watch-work",
		sessionId: options.sessionId ?? "s1",
	});
}

export interface Harness {
	runtime: WatchRuntime;
	config: WatchConfig;
	clock: Clock;
	/** Temp directory tests may write watched files into. */
	dir: string;
	spawn: SpawnFn;
	children: JobChild[];
	kills: Array<{ pid: number; signal: NodeJS.Signals; force?: boolean }>;
	cleanup: () => void;
}

/** Build a runtime wired to fake process primitives and a temp file directory. */
export function makeHarness(
	options: { script?: (child: JobChild) => void; config?: Partial<WatchConfig> } = {},
): Harness {
	const clock = makeClock(1000);
	const dir = mkdtempSync(join(tmpdir(), "pi-watch-"));
	const config: WatchConfig = { ...DEFAULT_CONFIG, pollMs: 1_000_000, ...options.config };
	const { spawn, children } = makeJobSpawn(options.script);
	const kills: Harness["kills"] = [];
	const killTree: KillTreeFn = (pid, signal, force) => {
		kills.push({ pid, signal, force });
	};
	const runtime = createWatchRuntime({
		spawn: spawn as unknown as SpawnFn,
		killTree,
		now: () => clock.advance(10),
		config,
		autoClock: false,
	});

	return {
		runtime,
		config,
		clock,
		dir,
		spawn: spawn as unknown as SpawnFn,
		children,
		kills,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

export interface HarnessSuite {
	makeHarness: (options?: Parameters<typeof makeHarness>[0]) => Harness;
	cleanup: () => void;
}

/** Build a suite-scoped harness factory whose `cleanup` removes every harness. */
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
