/**
 * Resolving a target and launching the OS-native handler.
 *
 * `normalizeTarget` and `buildCommand` are pure, so the command each platform
 * runs is asserted without a process. `openTarget` takes an injectable spawn so
 * a test launches nothing. Opening is best-effort: the caller decides what to do
 * with a failure, which is reported through `onError` rather than thrown, since
 * the launcher reports a start failure and a non-zero exit asynchronously.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { stripControlChars } from "../../lib/format.ts";

/** Whether to open the target itself or reveal it in the file manager. */
export type OpenMode = "open" | "reveal";

export interface NativeCommand {
	command: string;
	args: string[];
	/**
	 * Whether a non-zero exit means the target was not opened. Windows
	 * `explorer` can exit non-zero after a successful open, so it opts out.
	 */
	exitMeansFailure: boolean;
}

/**
 * Strip Pi's `@` file-mention prefix and any surrounding quotes from a target.
 * The editor's `@` completion keeps the `@` in the text, so `/open @src/app.ts`
 * and `/open @"my file.txt"` must be unwrapped before resolving. Control
 * characters are removed first so a pasted path cannot smuggle an escape into
 * the process arguments or the notification.
 */
export function normalizeTarget(raw: string): string {
	let target = stripControlChars(raw).trim();
	if (target.startsWith("@")) target = target.slice(1).trim();
	const quoted = (target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"));
	if (target.length >= 2 && quoted) target = target.slice(1, -1);
	return target.trim();
}

/** Resolve a requested target against `cwd`, raising a readable error when it is absent. */
export function resolveTarget(cwd: string, raw: string): string {
	const target = normalizeTarget(raw) || ".";
	const abs = isAbsolute(target) ? target : resolve(cwd, target);
	if (!existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);
	return abs;
}

/** The command that opens or reveals `target` on `platform`. */
export function buildCommand(
	mode: OpenMode,
	target: string,
	platform: NodeJS.Platform = process.platform,
): NativeCommand {
	if (platform === "darwin") {
		return mode === "reveal"
			? { command: "open", args: ["-R", target], exitMeansFailure: true }
			: { command: "open", args: [target], exitMeansFailure: true };
	}
	if (platform === "win32") {
		// `explorer` opens with the default handler without routing the path
		// through cmd, which would expand `%NAME%` inside it.
		return mode === "reveal"
			? { command: "explorer", args: [`/select,${target}`], exitMeansFailure: false }
			: { command: "explorer", args: [target], exitMeansFailure: false };
	}
	// Linux et al. xdg-open has no "select" verb, so reveal opens the parent.
	return {
		command: "xdg-open",
		args: [mode === "reveal" ? dirname(target) : target],
		exitMeansFailure: true,
	};
}

/** The child surface `openTarget` listens on; an injected launcher may return none. */
export interface LauncherChild {
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

/** A launcher seam; the default spawns the command detached. */
export type SpawnFn = (command: string, args: string[]) => LauncherChild | undefined;

export interface OpenTargetOptions {
	/** Platform to build the command for; defaults to the running one. */
	platform?: NodeJS.Platform;
	/** Override the launcher (tests). */
	spawn?: SpawnFn;
	/** Called once when the handler cannot start, or exits non-zero where that is meaningful. */
	onError?: (error: Error) => void;
}

/** Spawn the handler detached so the application outlives the session. */
const spawnDetached: SpawnFn = (command, args) => {
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.unref();
	return child;
};

/** Start the native handler for `target`, detached so it outlives the session. */
export function openTarget(mode: OpenMode, target: string, options: OpenTargetOptions = {}): void {
	const { command, args, exitMeansFailure } = buildCommand(mode, target, options.platform);
	const launch = options.spawn ?? spawnDetached;

	// A start failure and an exit both arrive asynchronously; report at most
	// one, since both can fire for the same launch.
	let reported = false;
	const report = (error: Error): void => {
		if (reported) return;
		reported = true;
		options.onError?.(error);
	};

	try {
		const child = launch(command, args);
		child?.on("error", report);
		if (child && exitMeansFailure) {
			child.on("exit", (code, signal) => {
				if (signal) report(new Error(`the OS handler was stopped by ${signal}`));
				else if (code !== 0) report(new Error(`the OS handler exited with status ${code}`));
			});
		}
	} catch (error) {
		report(toError(error));
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
