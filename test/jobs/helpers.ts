/**
 * Shared helpers for the jobs test suite.
 *
 * A `FakeChild` stands in for a spawned process; spawn/liveness/killTree are
 * injectable, so the runtime runs deterministically without real processes. The
 * registry points at a temp directory that is removed after each test.
 */

import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { JobsConfig } from "../../extensions/jobs/config.ts";
import { DEFAULT_CONFIG } from "../../extensions/jobs/config.ts";
import type { KillTreeFn, LivenessFn, SpawnFn, SpawnedProcess, StartTokenFn } from "../../extensions/jobs/process.ts";
import { createJobsRuntime, type JobsRuntime } from "../../extensions/jobs/runtime.ts";

/** A scriptable stand-in for a background child process. */
export class FakeChild extends EventEmitter implements SpawnedProcess {
	static nextPid = 5000;
	pid = FakeChild.nextPid++;
	stdout = new EventEmitter() as unknown as Readable;
	stderr = new EventEmitter() as unknown as Readable;
	killed = false;
	signals: string[] = [];
	command = "";
	cwd = "";

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
		this.signals.push(signal);
		return true;
	}

	/** Emit stdout data. */
	write(text: string): void {
		this.stdout.emit("data", Buffer.from(text));
	}

	/** Emit stderr data. */
	emitStderr(text: string): void {
		this.stderr.emit("data", Buffer.from(text));
	}

	/** Emit a close event. */
	close(code: number | null = 0, signal: string | null = null): void {
		this.emit("close", code, signal);
	}
}

export interface FakeSpawn {
	spawn: SpawnFn;
	children: FakeChild[];
}

/** Build a `SpawnFn` that records children and runs `script` in a microtask. */
export function makeFakeSpawn(script?: (child: FakeChild) => void): FakeSpawn {
	const children: FakeChild[] = [];
	const spawn: SpawnFn = (command, options) => {
		const child = new FakeChild();
		child.command = command;
		child.cwd = options.cwd;
		children.push(child);
		queueMicrotask(() => script?.(child));
		return child;
	};
	return { spawn, children };
}

export interface FakeCtx {
	ctx: any;
	statuses: Map<string, string | undefined>;
	widgets: Map<string, unknown>;
	notices: string[];
}

/** A minimal `ExtensionContext` for runtime and event handlers. */
export function makeCtx(options: { cwd?: string; mode?: string; sessionId?: string } = {}): FakeCtx {
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, unknown>();
	const notices: string[] = [];
	const ctx: any = {
		cwd: options.cwd ?? "/tmp/jobs-work",
		mode: options.mode ?? "print",
		hasUI: false,
		ui: {
			setStatus: (key: string, value?: string) => (value === undefined ? statuses.delete(key) : statuses.set(key, value)),
			setWidget: (key: string, value: unknown) => widgets.set(key, value),
			notify: (message: string) => notices.push(message),
			confirm: async () => true,
			custom: async () => undefined,
			theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
		},
		sessionManager: { getSessionId: () => options.sessionId ?? "s1", getBranch: () => [] },
	};
	return { ctx, statuses, widgets, notices };
}

export interface Harness {
	runtime: JobsRuntime;
	config: JobsConfig;
	dir: string;
	spawn: SpawnFn;
	children: FakeChild[];
	kills: Array<{ pid: number; signal: NodeJS.Signals; force?: boolean }>;
	dead: Set<number>;
	cleanup: () => void;
}

let clock = 1000;

/** Build a runtime wired to fake process primitives and a temp registry. */
export function makeHarness(options: {
	script?: (child: FakeChild) => void;
	config?: Partial<JobsConfig>;
	startToken?: StartTokenFn;
} = {}): Harness {
	const dir = mkdtempSync(join(tmpdir(), "pi-jobs-"));
	const config: JobsConfig = {
		...DEFAULT_CONFIG,
		registryDir: dir,
		killGraceMs: 5,
		repaintMs: 1_000_000,
		...options.config,
	};
	const { spawn, children } = makeFakeSpawn(options.script);
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
		now: () => (clock += 10),
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

/** Wait until `predicate` holds, or throw. */
export async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("waitFor timed out");
}

/** Read a job's log file, or "" when absent. */
export function readLog(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}
