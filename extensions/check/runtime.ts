/**
 * The check runtime: planning, sequencing, the live line buffer, and the one
 * active run.
 *
 * Detection is synchronous; a run is a sequence of bounded one-shot processes.
 * The runtime knows nothing about a language, a package manager, or a test
 * framework: it receives `CommandSpec`s and hands their output to the parser.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { stripControlChars } from "../../lib/format.ts";
import { LineSplitter } from "../../lib/lines.ts";
import { loadConfig, type CheckConfig } from "./config.ts";
import { planCommands } from "./detect.ts";
import { parseFailures } from "./failures.ts";
import { createRunner, type RunOutcome } from "./runner.ts";
import type { ActiveCheck, CheckResult, CheckStatus, CheckTarget, CommandSpec, Failure } from "./types.ts";

/** Lines kept for the live screen and the tail. */
const MAX_LINES = 5_000;
/** Lines in the tail shown in a detail view / model fallback. */
const TAIL_LINES = 40;
/** Characters kept from one output line before the TUI clips it. */
const MAX_LINE_CHARS = 2_000;
/** Failures retained across commands. */
const MAX_FAILURES = 200;

/** A planning or lifecycle error a command/tool can show verbatim. */
export class CheckError extends Error {}

export interface CheckRuntime {
	/** Start a run and return its observable handle. Throws `CheckError`. */
	start(target: CheckTarget, ctx: ExtensionContext, onUpdate?: () => void): ActiveCheck;
	/** Run to completion; planning errors become an error result, not a throw. */
	run(target: CheckTarget, ctx: ExtensionContext): Promise<CheckResult>;
	isRunning(): boolean;
	/** Cancel and release the active run (idempotent). */
	shutdown(): void;
}

export interface CheckRuntimeOptions {
	/** Fixed config, for tests; production loads it per run. */
	config?: CheckConfig;
	/** Runner seam, for tests. */
	runner?: (options: {
		cwd: string;
		command: string;
		timeoutMs: number;
		maxLogBytes: number;
		signal?: AbortSignal;
		onOutput?: (chunk: string) => void;
	}) => Promise<RunOutcome>;
	now?: () => number;
}

/** One sanitized line, bounded so a minified error cannot bloat the buffer. */
function cleanLine(line: string): string {
	return stripControlChars(line.replace(/\r$/, "")).slice(0, MAX_LINE_CHARS);
}

/** An error result for a plan or lifecycle failure. */
export function errorResult(target: CheckTarget, message: string): CheckResult {
	return {
		target,
		status: "error",
		commands: [],
		exitCode: null,
		durationMs: 0,
		truncated: false,
		failures: [],
		tail: "",
		error: message,
	};
}

/** Dedupe failures across commands, preserving command provenance. */
function mergeFailures(failures: readonly Failure[]): Failure[] {
	const seen = new Set<string>();
	const merged: Failure[] = [];
	for (const failure of failures) {
		const key = [
			failure.path ?? "",
			failure.line ?? "",
			failure.column ?? "",
			failure.test ?? "",
			failure.command,
			failure.message,
		].join("\u0000");
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(failure);
		if (merged.length >= MAX_FAILURES) break;
	}
	return merged;
}

export function createCheckRuntime(options: CheckRuntimeOptions = {}): CheckRuntime {
	const now = options.now ?? (() => Date.now());
	const runner = options.runner ?? createRunner();
	let active: ActiveCheck | undefined;
	let controller: AbortController | undefined;

	const configFor = (cwd: string): CheckConfig => options.config ?? loadConfig(cwd);

	const execute = async (
		target: CheckTarget,
		cwd: string,
		config: CheckConfig,
		commands: readonly CommandSpec[],
		lines: string[],
		signal: AbortSignal,
		onUpdate?: () => void,
	): Promise<CheckResult> => {
		const started = now();
		const outcomes: RunOutcome[] = [];
		const failures: Failure[] = [];
		const splitter = new LineSplitter();
		let status: CheckStatus = "passed";
		let error: string | undefined;

		const append = (line: string): void => {
			lines.push(cleanLine(line));
			if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
		};
		const flush = (): void => {
			for (const line of splitter.flush()) append(line);
		};
		const onOutput = (chunk: string): void => {
			for (const line of splitter.push(chunk)) append(line);
			onUpdate?.();
		};

		for (const spec of commands) {
			if (signal.aborted) {
				status = "cancelled";
				break;
			}
			append(`$ ${spec.command}`);
			let outcome: RunOutcome;
			try {
				outcome = await runner({
					cwd,
					command: spec.command,
					timeoutMs: config.timeoutMs,
					maxLogBytes: config.maxLogBytes,
					signal,
					onOutput,
				});
			} catch (failure) {
				status = "error";
				error = failure instanceof Error ? failure.message : String(failure);
				break;
			}
			flush();
			outcomes.push(outcome);
			if (outcome.cancelled) {
				status = "cancelled";
				break;
			}
			if (outcome.timedOut) {
				status = "timeout";
				break;
			}
			if (outcome.error) {
				status = "error";
				error = outcome.error;
				break;
			}
			if (outcome.exitCode !== 0) {
				status = "failed";
				failures.push(...parseFailures(outcome.output, spec.command, outcome.exitCode));
			}
			append("");
		}

		const exitCode =
			outcomes.find((outcome) => outcome.exitCode !== null && outcome.exitCode !== 0)?.exitCode ??
			outcomes.at(-1)?.exitCode ??
			null;
		const tail = lines.slice(-TAIL_LINES).join("\n");
		onUpdate?.();
		return {
			target,
			status,
			commands: commands.map((spec) => spec.label),
			exitCode,
			durationMs: Math.max(0, now() - started),
			truncated: outcomes.some((outcome) => outcome.truncated),
			failures: mergeFailures(failures),
			tail,
			...(error ? { error } : {}),
		};
	};

	const start = (target: CheckTarget, ctx: ExtensionContext, onUpdate?: () => void): ActiveCheck => {
		if (active) throw new CheckError("A check is already running.");
		const cwd = resolveEffectiveCwd(ctx.cwd);
		const config = configFor(cwd);
		const planned = planCommands(cwd, target, config.command);
		if (!planned.ok) throw new CheckError(planned.error);
		const commands = planned.commands;
		if (commands.length === 0) throw new CheckError("No check command detected.");

		const started = now();
		const lines: string[] = [];
		const runController = new AbortController();
		controller = runController;
		let handle: ActiveCheck;
		const promise = execute(target, cwd, config, commands, lines, runController.signal, onUpdate)
			.catch((error) => errorResult(target, error instanceof Error ? error.message : String(error)))
			.finally(() => {
				if (controller === runController) controller = undefined;
				if (active === handle) active = undefined;
			});
		handle = {
			target,
			commands: commands.map((spec) => spec.label),
			lines: () => lines,
			elapsedMs: () => Math.max(0, now() - started),
			promise,
			cancel: () => runController.abort(),
		};
		active = handle;
		return handle;
	};

	const run = async (target: CheckTarget, ctx: ExtensionContext): Promise<CheckResult> => {
		let handle: ActiveCheck;
		try {
			handle = start(target, ctx);
		} catch (error) {
			if (error instanceof CheckError) return errorResult(target, error.message);
			return errorResult(target, error instanceof Error ? error.message : String(error));
		}
		return handle.promise;
	};

	const shutdown = (): void => {
		controller?.abort();
		controller = undefined;
		active = undefined;
	};

	return {
		start,
		run,
		isRunning: () => active !== undefined,
		shutdown,
	};
}
