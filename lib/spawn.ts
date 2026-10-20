/**
 * The process seam shared by the extensions that run a shell command.
 *
 * `job`, `watch`, and `check` all start a command in its own process group,
 * stream or discard its output, and kill the whole tree — a signal to the POSIX
 * group, or `taskkill /T` on Windows. Only the policy on top differs (durable
 * jobs, a tailed watcher, a bounded check), so the seam lives here.
 *
 * IO is split from the decision: {@link spawnOptions} and {@link killPlan} are
 * pure and testable on every platform, while {@link defaultSpawn} and
 * {@link defaultKillTree} execute them. Value-only, like every `lib/` module:
 * no module state, and each caller keeps its own children.
 */

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * The writable end of a child's stdin pipe.
 *
 * Only the operations a caller needs, so tests can hand the runtime a recording
 * double instead of a real socket.
 */
export interface StdinSink {
	write(chunk: string): boolean;
	end(): void;
	destroy?(): void;
	on(event: "error" | "close", listener: (error?: Error) => void): unknown;
}

/** The subset of a spawned child the extensions use. */
export interface SpawnedProcess {
	pid?: number;
	stdout: Readable | null;
	stderr: Readable | null;
	/** Present only when the child was spawned with `stdin: true`. */
	stdin?: StdinSink | null;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
	/** Detach from the parent's event loop, so a child cannot hold Pi open. */
	unref?(): void;
}

export interface SpawnOptions {
	cwd: string;
	env?: NodeJS.ProcessEnv;
	/** Give the child a stdin pipe instead of a closed stdin (no immediate EOF). */
	stdin?: boolean;
	/** The command writes its own output to a log; keep no parent pipe. */
	detachOutput?: boolean;
}

export type SpawnFn = (command: string, options: SpawnOptions) => SpawnedProcess;

/** Send `signal` to a pid's process tree, escalating to SIGKILL when `force`. */
export type KillTreeFn = (pid: number, signal: NodeJS.Signals, force?: boolean) => void;

/** The `stdio` triple a spawn needs: stdin, stdout, stderr. */
export type SpawnStdio = ["pipe" | "ignore", "pipe" | "ignore", "pipe" | "ignore"];

/** The `child_process.spawn` options this seam produces. */
export interface NodeSpawnOptions {
	cwd: string;
	shell: boolean;
	detached: boolean;
	stdio: SpawnStdio;
	env?: NodeJS.ProcessEnv;
}

/**
 * The spawn options for one command: a shell in its own process group, so a
 * signal can reach the shell and its descendants together.
 *
 * Stdin stays closed unless asked for, because a closed stdin gives the child
 * EOF — a `read` exits instead of blocking forever. `detachOutput` keeps no
 * parent pipe, for a child that writes its own log file.
 */
export function spawnOptions(options: SpawnOptions, platform: NodeJS.Platform = process.platform): NodeSpawnOptions {
	return {
		cwd: options.cwd,
		shell: true,
		detached: platform !== "win32",
		stdio: [
			options.stdin ? "pipe" : "ignore",
			options.detachOutput ? "ignore" : "pipe",
			options.detachOutput ? "ignore" : "pipe",
		],
		env: options.env,
	};
}

/** What killing a pid's tree means on this platform. */
export interface KillPlan {
	/** A program to run instead of signalling (Windows has no process group). */
	command?: { file: string; args: string[] };
	/**
	 * Pids to signal in order: the process group first, then the pid itself for a
	 * child that is not a group leader (a reattached pid, for example).
	 */
	targets: number[];
}

/** The kill plan for `pid`: `taskkill /T` on Windows, group-then-pid otherwise. */
export function killPlan(pid: number, force: boolean, platform: NodeJS.Platform = process.platform): KillPlan {
	if (platform === "win32") {
		const args = ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])];
		return { command: { file: "taskkill", args }, targets: [] };
	}
	return { targets: [-pid, pid] };
}

/** A signal-0 probe; injectable so the EPERM branch is testable. */
export type KillProbe = (pid: number, signal: number) => unknown;

/** Whether a pid is alive on this host. EPERM means it exists but is not ours. */
export function isPidAlive(pid: number, probe: KillProbe = process.kill): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		probe(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** The host seams {@link applyKillPlan} runs through. */
export interface KillSeams {
	/** Signal one pid; throws when the pid is gone or not ours. */
	kill(pid: number, signal: NodeJS.Signals): unknown;
	/** Run a program (the Windows `taskkill`). */
	run(file: string, args: string[]): unknown;
}

/**
 * Execute a {@link KillPlan}: run the command, or signal each target in order.
 *
 * The group attempt may answer `ESRCH` for a pid that is not a group leader, and
 * the final attempt is the fallback, so its failure means "already gone" — a
 * kill of a dead process is not an error a caller can act on.
 */
export function applyKillPlan(plan: KillPlan, signal: NodeJS.Signals, seams: KillSeams): void {
	if (plan.command) {
		seams.run(plan.command.file, plan.command.args);
		return;
	}
	for (const [index, target] of plan.targets.entries()) {
		const isFallback = index === plan.targets.length - 1;
		try {
			seams.kill(target, signal);
			return;
		} catch (error) {
			if (!isFallback && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
}

/** The real seams, so a caller needs no adapter. */
const processSeams: KillSeams = {
	kill: (pid, signal) => process.kill(pid, signal),
	run: (file, args) => spawnSync(file, args, { stdio: "ignore" }),
};

/** Default spawn: a shell command in its own process group, output piped. */
export const defaultSpawn: SpawnFn = (command, options) => nodeSpawn(command, spawnOptions(options));

/** Default tree kill: process group on POSIX, `taskkill /T` on Windows. */
export const defaultKillTree: KillTreeFn = (pid, signal, force = false) => {
	applyKillPlan(killPlan(pid, force), signal, processSeams);
};
