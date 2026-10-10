import type { KeepAwakeRuntime } from "../../../extensions/keep-awake/runtime.ts";
import { DEFAULT_CONFIG } from "../../../extensions/keep-awake/config.ts";
import type { KeepAwakeConfig } from "../../../extensions/keep-awake/types.ts";
import { createKeepAwakeRuntime } from "../../../extensions/keep-awake/runtime.ts";
import { fakeCtx as sharedFakeCtx, type FakeCtxResult } from "../context.ts";
import { type JobChild, type KillTreeFn, makeJobSpawn } from "../process.ts";

export { makeJobSpawn as makeFakeSpawn, JobChild as FakeChild } from "../process.ts";

export interface Harness {
	runtime: KeepAwakeRuntime;
	ctxFake: FakeCtxResult;
	ctx: any;
	children: JobChild[];
	kills: Array<{ pid: number; signal: NodeJS.Signals; force?: boolean }>;
	config: KeepAwakeConfig;
}

export interface HarnessOptions {
	config?: Partial<KeepAwakeConfig>;
	platform?: NodeJS.Platform;
	piPid?: number;
	/** Runs once the runtime has attached its listeners (for error injection). */
	script?: (child: JobChild) => void;
}

/** Build a keep-awake runtime wired to fake process primitives and a TUI context. */
export function makeHarness(options: HarnessOptions = {}): Harness {
	const config: KeepAwakeConfig = { ...DEFAULT_CONFIG, ...options.config };
	const { spawn, children } = makeJobSpawn(options.script);
	const kills: Harness["kills"] = [];
	const killTree: KillTreeFn = (pid, signal, force) => {
		kills.push({ pid, signal, force });
	};
	const runtime = createKeepAwakeRuntime({
		spawn,
		killTree,
		platform: options.platform ?? "darwin",
		piPid: options.piPid ?? 4242,
		config,
	});
	const ctxFake = sharedFakeCtx({ mode: "tui", hasUI: true });
	return { runtime, ctxFake, ctx: ctxFake.ctx, children, kills, config };
}
