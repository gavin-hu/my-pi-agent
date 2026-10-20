/**
 * One-shot process runner for the check extension.
 *
 * A check is foreground and bounded: it streams stdout/stderr, keeps only a
 * tail, and dies with the command. This is deliberately smaller than `job`:
 * there is no registry, reattachment, stdin pipe, or detached lifetime, and the
 * runner never imports another extension's modules.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

/** The subset of a spawned child the runner uses. */
export interface SpawnedProcess {
	pid?: number;
	stdout: Readable | null;
	stderr: Readable | null;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

/** Injectable process factory. */
export type SpawnFn = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedProcess;

/** Injectable tree kill: POSIX process group, or a Windows taskkill. */
export type KillTreeFn = (pid: number, signal: NodeJS.Signals, force?: boolean) => void;

export interface RunOptions {
	cwd: string;
	command: string;
	/** Wall-clock limit; 0 disables it. */
	timeoutMs: number;
	/** Bytes kept from the end of stdout+stderr. */
	maxLogBytes: number;
	signal?: AbortSignal;
	/** Called with raw chunks as they arrive, for the live screen. */
	onOutput?: (chunk: string) => void;
}

export interface RunOutcome {
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	cancelled: boolean;
	/** The retained tail, not necessarily the whole output. */
	output: string;
	truncated: boolean;
	durationMs: number;
	/** A spawn failure, if the command could not start. */
	error?: string;
}

export interface RunnerOptions {
	spawn?: SpawnFn;
	killTree?: KillTreeFn;
	now?: () => number;
	/** Time between SIGTERM and SIGKILL; tests shorten it. */
	killGraceMs?: number;
}

/** The default spawn: a shell command in its own process group on POSIX. */
export const defaultSpawn: SpawnFn = (command, options) =>
	nodeSpawn(command, {
		cwd: options.cwd,
		shell: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
		env: options.env,
	});

/** Kill a process tree, escalating to taskkill `/F` on Windows. */
export const defaultKillTree: KillTreeFn = (pid, signal, force = false) => {
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
};

/**
 * A string buffer that keeps the last `maxBytes` bytes.
 *
 * Output is already a string; slicing by characters is close enough at a
 * megabyte scale, and keeps a multi-byte character whole. `truncated` is set
 * once anything is dropped.
 */
export class BoundedLog {
	private buffer = "";
	private truncated = false;

	constructor(private readonly maxBytes: number) {}

	append(chunk: string): void {
		if (!chunk) return;
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) <= this.maxBytes) return;
		this.truncated = true;
		this.buffer = this.buffer.slice(-this.maxBytes);
	}

	text(): string {
		return this.buffer;
	}

	get wasTruncated(): boolean {
		return this.truncated;
	}
}

/** The checker's env: no color, no pager, no interactive prompts, CI mode. */
export function checkEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return {
		...base,
		CI: "1",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		TERM: "dumb",
		GIT_PAGER: "cat",
		PAGER: "cat",
	};
}

/** Build a runner over injected process seams. */
export function createRunner(options: RunnerOptions = {}): (options: RunOptions) => Promise<RunOutcome> {
	const spawn = options.spawn ?? defaultSpawn;
	const killTree = options.killTree ?? defaultKillTree;
	const now = options.now ?? (() => Date.now());
	const killGraceMs = options.killGraceMs ?? 2_000;

	return (run) =>
		new Promise<RunOutcome>((resolve) => {
			const started = now();
			const log = new BoundedLog(run.maxLogBytes);
			let settled = false;
			let timedOut = false;
			let cancelled = false;
			let spawnError: string | undefined;
			let killTimer: ReturnType<typeof setTimeout> | undefined;
			let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
			let child: SpawnedProcess | undefined;

			const settle = (exitCode: number | null, signal: string | null): void => {
				if (settled) return;
				settled = true;
				if (killTimer) clearTimeout(killTimer);
				if (timeoutTimer) clearTimeout(timeoutTimer);
				run.signal?.removeEventListener("abort", onAbort);
				resolve({
					exitCode,
					signal,
					timedOut,
					cancelled,
					output: log.text(),
					truncated: log.wasTruncated,
					durationMs: Math.max(0, now() - started),
					...(spawnError ? { error: spawnError } : {}),
				});
			};

			const stop = (reason: "timeout" | "abort"): void => {
				if (settled) return;
				if (reason === "timeout") timedOut = true;
				else cancelled = true;
				const pid = child?.pid;
				if (!pid) {
					child?.kill("SIGTERM");
					return;
				}
				killTree(pid, "SIGTERM");
				killTimer = setTimeout(() => {
					if (!settled) killTree(pid, "SIGKILL", true);
				}, killGraceMs);
				killTimer.unref?.();
			};

			const onAbort = (): void => stop("abort");
			if (run.signal?.aborted) {
				cancelled = true;
				settle(null, null);
				return;
			}
			run.signal?.addEventListener("abort", onAbort, { once: true });

			try {
				child = spawn(run.command, { cwd: run.cwd, env: checkEnv() });
			} catch (error) {
				spawnError = error instanceof Error ? error.message : String(error);
				settle(null, null);
				return;
			}

			const onData = (chunk: Buffer | string): void => {
				const text = String(chunk);
				log.append(text);
				if (run.onOutput) run.onOutput(text);
			};
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);
			child.on("error", (error) => {
				spawnError = error.message;
				// Node follows an error with close; still settle if a fake does not.
				settle(null, null);
			});
			child.on("close", (code, signal) => settle(code, signal));

			if (run.timeoutMs > 0) {
				timeoutTimer = setTimeout(() => stop("timeout"), run.timeoutMs);
				timeoutTimer.unref?.();
			}
		});
}
