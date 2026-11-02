/**
 * Running one subagent subprocess.
 *
 * Spawns `pi --mode json`, folds the JSON event stream into a `SingleResult`,
 * enforces the run's deadline, streams partial updates, and cleans up the temporary
 * system-prompt file. The process factory is injectable so tests can drive a
 * scripted child.
 */

import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { formatDuration } from "../../lib/format.ts";
import { LineSplitter } from "../../lib/lines.ts";
import { BUILTIN_AGENTS, formatAgentList, type AgentConfig } from "./agents.ts";
import { buildAgentArgs, getPiInvocation, READ_ONLY_NOTE } from "./invocation.ts";
import { applyEvent, createResult, parseJsonLine } from "./stream.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SpawnFn, SubagentDetails } from "./types.ts";

export interface RunOptions {
	/** Session cwd used when the caller supplies no per-task cwd. */
	defaultCwd: string;
	/** Model/thinking inherited when the built-in agent sets none. */
	defaults: DispatchDefaults;
	agentName: string;
	task: string;
	/** Original chain step task, before `{previous}` substitution; display only. */
	taskTemplate?: string;
	cwd?: string;
	/** Resolved agent pool; defaults to the built-ins when omitted. */
	agents?: readonly AgentConfig[];
	/** 1-based chain step, recorded on the result. */
	step?: number;
	/** Force the child to a read-only tool set (plan mode). */
	readOnly?: boolean;
	signal?: AbortSignal;
	onUpdate?: OnUpdateCallback;
	/** Builds the details payload for this mode from the current results. */
	makeDetails: (results: SingleResult[]) => SubagentDetails;
	/** Process factory; defaults to `node:child_process.spawn`. */
	spawn?: SpawnFn;
	/** Per-run wall-clock limit in ms; `0` or absent disables it. */
	timeoutMs?: number;
	/** Grace before a killed child is escalated to SIGKILL; a test seam, not a setting. */
	escalationMs?: number;
	/** Return an aborted result instead of throwing (used by background runs). */
	abortAsResult?: boolean;
}

/**
 * The prompt file a child is handed, and its directory.
 *
 * The directory is created first, so a write that fails has to take it back: the caller
 * learns the path only on success, and a temp directory left behind is a leak per attempt.
 */
async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(dir, `prompt-${safeName}.md`);
	try {
		await withFileMutationQueue(filePath, async () => {
			await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
		});
	} catch (error) {
		await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
	return { dir, filePath };
}

interface SpawnOutcome {
	exitCode: number;
	aborted: boolean;
	timedOut: boolean;
}

/** How long a killed child has to exit before it is killed again, hard. */
const KILL_ESCALATION_MS = 5000;

/** Why a child is being killed; a timeout fails the run, an abort rejects the call. */
type KillReason = "abort" | "timeout";

interface SpawnContext {
	command: string;
	args: string[];
	cwd: string;
	/** Per-run wall-clock limit in ms; `0` disables it. */
	timeoutMs: number;
	/** Grace before SIGTERM escalates to SIGKILL. */
	escalationMs?: number;
	signal?: AbortSignal;
	result: SingleResult;
	onEvent: () => void;
	spawn: SpawnFn;
}

/** Spawn the child, parse stdout line-by-line, and resolve when it closes. */
function spawnAndCollect(context: SpawnContext): Promise<SpawnOutcome> {
	const { command, args, cwd, timeoutMs, escalationMs, signal, result, onEvent, spawn } = context;
	return new Promise<SpawnOutcome>((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		const splitter = new LineSplitter();
		let settled = false;
		let abortRequested = false;
		let timedOut = false;

		let killTimer: ReturnType<typeof setTimeout> | undefined;
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

		const kill = (reason: KillReason) => {
			if (settled) return;
			if (reason === "abort") abortRequested = true;
			else {
				timedOut = true;
				result.timedOut = true;
			}
			proc.kill("SIGTERM");
			// `proc.killed` only says a signal was sent, so a child that ignores SIGTERM is alive
			// with it set — liveness here is this call's own `settled`, set when `close` fires.
			if (killTimer) clearTimeout(killTimer);
			killTimer = setTimeout(() => {
				killTimer = undefined;
				if (!settled) proc.kill("SIGKILL");
			}, escalationMs ?? KILL_ESCALATION_MS);
			killTimer.unref();
		};
		const onAbort = () => kill("abort");

		const finish = (exitCode: number) => {
			if (settled) return;
			settled = true;
			if (signal) signal.removeEventListener("abort", onAbort);
			if (killTimer) clearTimeout(killTimer);
			if (timeoutTimer) clearTimeout(timeoutTimer);
			for (const line of splitter.flush()) {
				if (line.trim()) processLine(line);
			}
			resolve({ exitCode, aborted: abortRequested, timedOut });
		};

		const processLine = (line: string) => {
			const event = parseJsonLine(line);
			if (event && applyEvent(result, event)) onEvent();
		};

		proc.stdout?.on("data", (chunk) => {
			// The splitter holds the final partial line for the close handler.
			for (const line of splitter.push(chunk)) processLine(line);
		});

		proc.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			result.stderr += text;
		});

		proc.on("close", (code, signal) => {
			// A signal-terminated child has `code === null`; without this it would be
			// read as exit 0 and reported as a success with no output.
			if (code === null && signal) {
				result.stderr = result.stderr || `Terminated by ${signal}`;
				finish(1);
				return;
			}
			finish(code ?? 0);
		});
		proc.on("error", (error) => {
			result.stderr = String(error);
			finish(1);
		});

		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}
		if (timeoutMs > 0) {
			timeoutTimer = setTimeout(() => kill("timeout"), timeoutMs);
			timeoutTimer.unref();
		}
	});
}

/**
 * Run one subagent to completion.
 *
 * Never throws for a missing agent or a failing subprocess; those come back as
 * a `SingleResult` with a non-zero exit code. Throws only when the caller
 * aborts a run that had started.
 */
export async function runSingleAgent(options: RunOptions): Promise<SingleResult> {
	const spawn = options.spawn ?? nodeSpawn;
	const pool = options.agents ?? BUILTIN_AGENTS;
	const agent = pool.find((candidate) => candidate.name === options.agentName);

	const result = createResult(options.agentName, options.task, {
		agentSource: agent?.source ?? "unknown",
		taskTemplate: options.taskTemplate,
		step: options.step,
		startedAt: Date.now(),
	});

	if (!agent) {
		result.exitCode = 1;
		result.stderr = `Unknown agent: "${options.agentName}". Available agents: ${formatAgentList(pool)}.`;
		return result;
	}

	const emit = () => options.onUpdate?.({ content: [], details: options.makeDetails([result]) });

	const timeoutMs = options.timeoutMs ?? 0;
	if (timeoutMs > 0) result.timeoutMs = timeoutMs;
	let runCwd = options.defaultCwd;

	let tempDir: string | null = null;
	let tempPath: string | null = null;

	try {
		const systemPrompt = options.readOnly
			? [agent.systemPrompt, READ_ONLY_NOTE].filter(Boolean).join("\n\n")
			: agent.systemPrompt;
		if (systemPrompt.trim()) {
			try {
				const tmp = await writePromptToTempFile(agent.name, systemPrompt);
				tempDir = tmp.dir;
				tempPath = tmp.filePath;
			} catch (error) {
				// A full or unwritable TMPDIR fails this run, not the chain that asked for it.
				result.exitCode = 1;
				result.finishedAt = Date.now();
				result.errorMessage = `Could not write the agent's prompt: ${error instanceof Error ? error.message : String(error)}`;
				result.stderr = result.errorMessage;
				return result;
			}
		}

		const args = buildAgentArgs(agent, options.task, options.defaults, tempPath, options.readOnly === true);
		const invocation = getPiInvocation(args);
		runCwd = options.cwd ? path.resolve(options.defaultCwd, options.cwd) : options.defaultCwd;
		const outcome = await spawnAndCollect({
			command: invocation.command,
			args: invocation.args,
			cwd: runCwd,
			timeoutMs,
			escalationMs: options.escalationMs,
			signal: options.signal,
			result,
			onEvent: emit,
			spawn,
		});

		result.exitCode = outcome.timedOut || outcome.aborted ? 1 : outcome.exitCode;
		result.finishedAt = Date.now();
		// A deadline fails the run rather than rejecting it: a chain then stops at
		// this step and reports why, instead of discarding the steps already done.
		if (outcome.timedOut) result.errorMessage = `Timed out after ${formatDuration(timeoutMs)}`;
		if (outcome.aborted) {
			if (options.abortAsResult) {
				result.stopReason = "aborted";
				result.errorMessage = "Aborted";
				return result;
			}
			// The partial result travels on the error: the run spent tokens before the abort, and
			// the caller's accounting publishes what the child reached rather than nothing.
			throw Object.assign(new Error("Subagent was aborted"), { result });
		}
		return result;
	} finally {
		if (tempPath) {
			try {
				fs.unlinkSync(tempPath);
			} catch {
				/* ignore */
			}
		}
		if (tempDir) {
			try {
				fs.rmdirSync(tempDir);
			} catch {
				/* ignore */
			}
		}
	}
}
