/**
 * Process plumbing for the jobs extension.
 *
 * Background jobs must outlive a single tool call, so they are spawned with
 * Node's `child_process` rather than `pi.exec` (which resolves only when the
 * command finishes). Every function here is injectable, so tests can drive a
 * scripted child without launching a real process.
 *
 * On POSIX the child is started detached, making it a process-group leader;
 * signals go to the whole group (`-pid`) so a shell and its descendants die
 * together. On Windows the tree is killed with `taskkill /T`.
 */

import { execFileSync, spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

/** The subset of a spawned child the runtime uses. */
export interface SpawnedProcess {
	pid?: number;
	stdout: Readable | null;
	stderr: Readable | null;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (command: string, options: { cwd: string; env?: NodeJS.ProcessEnv }) => SpawnedProcess;

/** Whether a pid is still alive. */
export type LivenessFn = (pid: number) => boolean;

/** Send `signal` to a pid's process tree, escalating to SIGKILL when `force`. */
export type KillTreeFn = (pid: number, signal: NodeJS.Signals, force?: boolean) => void;

/**
 * Best-effort OS start-time token for a pid, used to detect pid reuse.
 * Returns undefined when the platform cannot provide one (for example Windows,
 * or a process that is already gone), in which case callers fall back to
 * liveness alone.
 */
export type StartTokenFn = (pid: number) => string | undefined;

/** Default spawn: a shell command in its own process group with piped output. */
export const defaultSpawn: SpawnFn = (command, options) =>
	nodeSpawn(command, {
		cwd: options.cwd,
		shell: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
		env: options.env,
	});

/** Default liveness check. EPERM means the pid exists but is owned by someone else. */
export const defaultLiveness: LivenessFn = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** Default start-time token via `ps`. Undefined where `ps` is unavailable. */
export const defaultStartToken: StartTokenFn = (pid) => {
	try {
		const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2000,
		});
		const text = out.toString().trim();
		return text || undefined;
	} catch {
		return undefined;
	}
};

/** Default tree kill: process group on POSIX, `taskkill /T` on Windows. */
export const defaultKillTree: KillTreeFn = (pid, signal, force = false) => {
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		// Not a group leader (for example a reattached pid); signal it directly.
		// Callers verify the start token first, so this cannot hit a reused pid.
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
};
