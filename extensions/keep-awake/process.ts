/**
 * Process plumbing for keep-awake.
 *
 * The inhibitor is a child process that outlives a single call, so it is
 * spawned with `child_process` rather than `pi.exec` (which resolves only when
 * the command exits). Both `spawn` and `killTree` are injectable, so tests can
 * drive a scripted child without launching a real process.
 *
 * On POSIX the child is started detached, making it a process-group leader, so
 * a signal to `-pid` reaches the shell and its `sleep`/`caffeinate` child
 * together. On Windows the tree is killed with `taskkill /T`.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
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

/** Send `signal` to a pid's process tree, escalating to SIGKILL when `force`. */
export type KillTreeFn = (pid: number, signal: NodeJS.Signals, force?: boolean) => void;

/** Default spawn: a hidden shell command in its own process group. */
export const defaultSpawn: SpawnFn = (command, options) =>
	nodeSpawn(command, {
		cwd: options.cwd,
		shell: true,
		detached: process.platform !== "win32",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: options.env,
	}) as SpawnedProcess;

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
		// Not a group leader; signal it directly. The child is our own, so this
		// cannot hit a reused pid.
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
};
