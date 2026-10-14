/**
 * Process plumbing for the watch extension's command sources.
 *
 * A command watcher outlives a single tool call, so it is spawned with Node's
 * `child_process` and its merged stdout/stderr are piped back as data events.
 * Every function here is injectable so tests can drive a scripted child without
 * launching a real process.
 *
 * On POSIX the child is started detached, making it a process-group leader;
 * signals go to the whole group (`-pid`) so a shell and its descendants die
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

export interface SpawnOptions {
	cwd: string;
	env?: NodeJS.ProcessEnv;
}

export type SpawnFn = (command: string, options: SpawnOptions) => SpawnedProcess;

/** Send `signal` to a pid's process tree, escalating to SIGKILL when `force`. */
export type KillTreeFn = (pid: number, signal: NodeJS.Signals, force?: boolean) => void;

/** Default spawn: a shell command in its own process group, output piped. */
export const defaultSpawn: SpawnFn = (command, options) =>
	nodeSpawn(command, {
		cwd: options.cwd,
		shell: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
		env: options.env,
	});

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
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
};
