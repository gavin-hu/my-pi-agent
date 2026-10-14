/**
 * Resolving a target and launching the OS-native handler.
 *
 * `normalizeTarget` and `buildCommand` are pure, so the command each platform
 * runs is asserted without a process. `openTarget` takes an injectable spawn so
 * a test launches nothing. Opening is best-effort: the caller decides what to do
 * with a failure, which is reported through `onError` rather than thrown, since
 * `spawn` reports a missing handler asynchronously.
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
		return mode === "reveal" ? { command: "open", args: ["-R", target] } : { command: "open", args: [target] };
	}
	if (platform === "win32") {
		return mode === "reveal"
			? { command: "explorer", args: [`/select,${target}`] }
			: { command: "cmd", args: ["/c", "start", "", target] };
	}
	// Linux et al. xdg-open has no "select" verb, so reveal opens the parent.
	return { command: "xdg-open", args: [mode === "reveal" ? dirname(target) : target] };
}

/** A launcher seam; the default spawns the command detached. */
export type SpawnFn = (command: string, args: string[]) => unknown;

export interface OpenTargetOptions {
	/** Platform to build the command for; defaults to the running one. */
	platform?: NodeJS.Platform;
	/** Override the launcher (tests). */
	spawn?: SpawnFn;
	/** Called when the handler cannot be started or reports an error. */
	onError?: (error: Error) => void;
}

/** Start the native handler for `target`, detached so it outlives the session. */
export function openTarget(mode: OpenMode, target: string, options: OpenTargetOptions = {}): void {
	const { command, args } = buildCommand(mode, target, options.platform);
	const onError = options.onError;

	if (options.spawn) {
		try {
			options.spawn(command, args);
		} catch (error) {
			onError?.(toError(error));
		}
		return;
	}

	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.on("error", (error) => onError?.(error));
		child.unref();
	} catch (error) {
		onError?.(toError(error));
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
