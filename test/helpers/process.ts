/**
 * Shared fake child-process doubles.
 *
 * The job and subagent suites spawn processes with different `SpawnFn`
 * signatures and consume stdout with different encodings, so there are two
 * child doubles here; `waitFor` is shared.
 */

import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";
import type { KillTreeFn, LivenessFn, SpawnFn, SpawnedProcess, StartTokenFn } from "../../extensions/job/process.ts";
import type { SpawnFn as SubagentSpawnFn } from "../../extensions/subagent/types.ts";

/** A scriptable stand-in for a background job process. */
export class JobChild extends EventEmitter implements SpawnedProcess {
	static nextPid = 5000;
	pid = JobChild.nextPid++;
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

export interface FakeJobSpawn {
	spawn: SpawnFn;
	children: JobChild[];
}

/** Build a job `SpawnFn` that records children and runs `script` in a microtask. */
export function makeJobSpawn(script?: (child: JobChild) => void): FakeJobSpawn {
	const children: JobChild[] = [];
	const spawn: SpawnFn = (command, options) => {
		const child = new JobChild();
		child.command = command;
		child.cwd = options.cwd;
		children.push(child);
		queueMicrotask(() => script?.(child));
		return child;
	};
	return { spawn, children };
}

export type { KillTreeFn, LivenessFn, SpawnFn, StartTokenFn };

/** A scriptable stand-in for a spawned `pi` subagent process. */
export class SubagentChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	killed = false;
	killSignals: NodeJS.Signals[] = [];
	command = "";
	args: string[] = [];
	options: SpawnOptions | undefined;

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
		this.killSignals.push(signal);
		return true;
	}

	/** Emit one complete stdout line. */
	line(value: unknown): void {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		this.stdout.emit("data", `${text}\n`);
	}

	write(text: string): void {
		this.stdout.emit("data", text);
	}

	emitStderr(text: string): void {
		this.stderr.emit("data", text);
	}

	close(code = 0): void {
		this.emit("close", code);
	}

	/** Emit a spawn-time error and then a close, as Node does. */
	fail(error: Error = new Error("spawn failed")): void {
		this.emit("error", error);
		this.emit("close", 1);
	}
}

export interface FakeSubagentSpawn {
	spawn: SubagentSpawnFn;
	children: SubagentChild[];
}

/**
 * Build a subagent `SpawnFn` that records children and, once the caller has
 * attached its listeners, runs `script` in a microtask.
 */
export function makeSubagentSpawn(
	script?: (child: SubagentChild, args: string[], options: SpawnOptions) => void,
): FakeSubagentSpawn {
	const children: SubagentChild[] = [];
	const spawn: SubagentSpawnFn = (command, args, options) => {
		const child = new SubagentChild();
		child.command = command;
		child.args = args;
		child.options = options;
		children.push(child);
		queueMicrotask(() => script?.(child, args, options));
		return child as unknown as ChildProcess;
	};
	return { spawn, children };
}

/**
 * Let pending work run. With `ms` omitted this yields the macrotask queue once
 * so already-scheduled continuations settle; with `ms` it waits real time for
 * a short injected timer (for example a job's kill grace). Tests use this
 * instead of `setTimeout` so the banned-pattern check stays meaningful.
 */
export async function settle(ms = 0): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until `predicate` holds, or throw after `attempts` macrotask turns.
 * Prefer `settle` plus an assertion when the completion point is known.
 */
export async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (predicate()) return;
		await settle();
	}
	throw new Error("waitFor timed out");
}
