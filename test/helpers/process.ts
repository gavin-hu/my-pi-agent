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
import type { KillTreeFn, SpawnFn, SpawnedProcess } from "../../lib/spawn.ts";
import type { LivenessFn, StartTokenFn } from "../../extensions/job/process.ts";
import type { SpawnFn as SubagentSpawnFn } from "../../extensions/subagent/types.ts";

/** A recording stand-in for a job's stdin pipe. */
export class FakeStdin extends EventEmitter {
	writes: string[] = [];
	ended = false;
	destroyed = false;
	/** Throw on the next write, as a child that closed its end does. */
	failWith?: Error;

	write(chunk: string): boolean {
		if (this.failWith) {
			const error = this.failWith;
			this.failWith = undefined;
			throw error;
		}
		this.writes.push(String(chunk));
		return true;
	}

	end(): void {
		this.ended = true;
		this.emit("close");
	}

	destroy(): void {
		this.destroyed = true;
	}

	/** Everything written so far, joined. */
	get text(): string {
		return this.writes.join("");
	}
}

/** A scriptable stand-in for a background job process. */
export class JobChild extends EventEmitter implements SpawnedProcess {
	static nextPid = 5000;
	pid = JobChild.nextPid++;
	stdout = new EventEmitter() as unknown as Readable;
	stderr = new EventEmitter() as unknown as Readable;
	/** The stdin double, present only when the job was spawned with `stdin: true`. */
	stdinSink: FakeStdin | null = null;
	killed = false;
	signals: string[] = [];
	command = "";
	cwd = "";
	options: { cwd: string; env?: NodeJS.ProcessEnv; detachOutput?: boolean; stdin?: boolean } | undefined;
	unrefed = false;

	get stdin(): FakeStdin | null {
		return this.stdinSink;
	}

	unref(): void {
		this.unrefed = true;
	}

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
		this.signals.push(signal);
		return true;
	}

	/** Emit stdout data. */
	write(text: string): void {
		this.stdout.emit("data", Buffer.from(text));
	}

	/** Emit raw stdout bytes, to model a read boundary inside a character. */
	writeBytes(bytes: Uint8Array): void {
		this.stdout.emit("data", Buffer.from(bytes));
	}

	/** Emit stderr data. */
	emitStderr(text: string): void {
		this.stderr.emit("data", Buffer.from(text));
	}

	/** Emit a close event. */
	close(code: number | null = 0, signal: string | null = null): void {
		this.emit("close", code, signal);
	}

	/** Emit a spawn-time error; a caller that models Node's close sends it next. */
	fail(message: string | Error = "spawn failed"): void {
		this.emit("error", typeof message === "string" ? new Error(message) : message);
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
		child.options = options;
		if (options.stdin) child.stdinSink = new FakeStdin();
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

	close(code: number | null = 0, signal: string | null = null): void {
		this.emit("close", code, signal);
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
 * Wait until `predicate` holds, or throw after `budgetMs` of real time.
 *
 * The budget is elapsed time, not a count of macrotask turns, because what these
 * predicates wait on is the host, not injected time: a run writes a temp prompt
 * file through the process-wide file queue before it spawns, and a loaded machine
 * can take longer over that write than any fixed number of ~1 ms turns. A turn
 * count turns such a wait into a coin flip on runner load; the work always
 * finishes. The wall clock is right here for that reason, and this helper is the
 * one place that reads it.
 *
 * Prefer `settle` plus an assertion when the completion point is known.
 */
export async function waitFor(predicate: () => boolean, budgetMs = 2000): Promise<void> {
	const deadline = Date.now() + Math.max(1, budgetMs);
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`waitFor timed out after ${budgetMs}ms`);
		await settle();
	}
}
