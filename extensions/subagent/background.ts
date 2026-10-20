/**
 * Background subagent runs.
 *
 * A background run is the same child process and result as a foreground one;
 * only the wait moves off the tool call. The session branch is the durable
 * record: a start entry, then a finish entry. The live map keeps a bounded
 * preview and the final output for collection; after a restart the branch can
 * only report a start without a finish as interrupted.
 */

import { resolve } from "node:path";
import { formatDuration, sanitizeLine, stripControlChars } from "../../lib/format.ts";
import type { AgentConfig } from "./agents.ts";
import { formatUsageStats } from "./format.ts";
import type { RunOptions } from "./run.ts";
import { createResult, getFinalOutput, isFailedResult } from "./stream.ts";
import type { DispatchDefaults, SingleResult, UsageStats } from "./types.ts";

/** Custom-entry type for a background run start or finish. */
export const BACKGROUND_ENTRY = "subagent-background";

/** Cap on the output stored in the entry and sent by collect. */
const MAX_OUTPUT_CHARS = 50 * 1024;
/** Cap on the live preview shown while a run is active. */
const MAX_PREVIEW_CHARS = 8 * 1024;
/** Cap on the task stored in an entry. */
const MAX_TASK_CHARS = 4 * 1024;

export type BackgroundStatus = "running" | "finished" | "failed" | "cancelled" | "timedout" | "interrupted";

/** One background run as the board and collect see it. */
export interface BackgroundRun {
	id: string;
	agent: string;
	task: string;
	cwd: string;
	startedAt: number;
	finishedAt?: number;
	status: BackgroundStatus;
	exitCode?: number | null;
	stopReason?: string;
	errorMessage?: string;
	usage?: UsageStats;
	/** Latest bounded output: a live preview while running, final output after. */
	output?: string;
	artifactPath?: string;
}

interface StartEntry {
	phase: "start";
	runId: string;
	agent: string;
	task: string;
	cwd: string;
	startedAt: number;
	agentSource?: string;
	readOnly?: boolean;
}

interface FinishEntry {
	phase: "finish";
	runId: string;
	finishedAt: number;
	status: Exclude<BackgroundStatus, "running" | "interrupted">;
	exitCode: number | null;
	stopReason?: string;
	errorMessage?: string;
	usage: UsageStats;
	output: string;
	artifactPath?: string;
}

type BackgroundEntry = StartEntry | FinishEntry;

export interface BackgroundStartInput {
	agent: string;
	task: string;
	cwd?: string;
	readOnly?: boolean;
}

export type BackgroundStartResult = { ok: true; run: BackgroundRun } | { ok: false; error: string };

export interface BackgroundRuntime {
	start(input: BackgroundStartInput, branch: readonly unknown[], run: BackgroundRunDeps): BackgroundStartResult;
	list(branch: readonly unknown[]): BackgroundRun[];
	/** The text a collect sends, or the reason it cannot be collected. */
	collect(runId: string, branch: readonly unknown[]): { ok: true; text: string } | { ok: false; reason: string };
	/** Abort one running child. */
	cancel(runId: string): boolean;
	/** Abort every child and stop accepting late writes. */
	shutdown(): void;
	/** Clear the disposed flag and live rows for a new session. */
	reset(): void;
	/** Repaint hook; returns an unsubscribe. */
	subscribe(listener: () => void): () => void;
}

export interface BackgroundDeps {
	appendEntry(customType: string, data: unknown): void;
	/** Called once when a run reaches a terminal state. */
	onFinish?(run: BackgroundRun): void;
	now?: () => number;
}

/** Everything one start needs from the tool call's resolved context. */
export interface BackgroundRunDeps {
	run(options: RunOptions): Promise<SingleResult>;
	agents: readonly AgentConfig[];
	defaults: DispatchDefaults;
	defaultCwd: string;
	timeoutMs: number;
	transcripts?: RunOptions["transcripts"];
	backgroundMax: number;
}

/** A finite, non-negative number or undefined. */
function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Read one custom entry's data if it is a background entry. */
function readEntry(raw: unknown): BackgroundEntry | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
	if (
		entry.type !== "custom" ||
		entry.customType !== BACKGROUND_ENTRY ||
		!entry.data ||
		typeof entry.data !== "object"
	) {
		return undefined;
	}
	const data = entry.data as Record<string, unknown>;
	if (typeof data.runId !== "string" || data.runId === "") return undefined;
	if (data.phase === "start") {
		if (typeof data.agent !== "string" || typeof data.task !== "string" || typeof data.cwd !== "string") {
			return undefined;
		}
		const startedAt = count(data.startedAt);
		if (startedAt === undefined) return undefined;
		return {
			phase: "start",
			runId: data.runId,
			agent: data.agent,
			task: data.task,
			cwd: data.cwd,
			startedAt,
			...(typeof data.agentSource === "string" ? { agentSource: data.agentSource } : {}),
			...(typeof data.readOnly === "boolean" ? { readOnly: data.readOnly } : {}),
		};
	}
	if (data.phase === "finish") {
		const finishedAt = count(data.finishedAt);
		const usage = data.usage as UsageStats | undefined;
		if (finishedAt === undefined || !usage || typeof usage !== "object") return undefined;
		if (!["finished", "failed", "cancelled", "timedout"].includes(String(data.status))) return undefined;
		return {
			phase: "finish",
			runId: data.runId,
			finishedAt,
			status: data.status as FinishEntry["status"],
			exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
			...(typeof data.stopReason === "string" ? { stopReason: data.stopReason } : {}),
			...(typeof data.errorMessage === "string" ? { errorMessage: data.errorMessage } : {}),
			usage,
			output: typeof data.output === "string" ? data.output : "",
			...(typeof data.artifactPath === "string" ? { artifactPath: data.artifactPath } : {}),
		};
	}
	return undefined;
}

/** The status a finished result represents. */
function statusOf(result: SingleResult): FinishEntry["status"] {
	if (result.timedOut) return "timedout";
	if (result.stopReason === "aborted") return "cancelled";
	if (isFailedResult(result)) return "failed";
	return "finished";
}

/** The final assistant text, bounded for entry storage and collect. */
function finalOutput(result: SingleResult): string {
	const text = stripControlChars(getFinalOutput(result.messages) || result.stderr.trim());
	return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated` : text;
}

/** The latest output for a running run, bounded and kept at the tail. */
function liveOutput(result: SingleResult): string {
	const text = stripControlChars(getFinalOutput(result.messages) || result.stderr.trim());
	if (text.length <= MAX_PREVIEW_CHARS) return text;
	return `… earlier output omitted\n${text.slice(-MAX_PREVIEW_CHARS)}`;
}

/** One run from a start entry and an optional finish. */
function runFromEntries(start: StartEntry, finish?: FinishEntry): BackgroundRun {
	return {
		id: start.runId,
		agent: start.agent,
		task: start.task,
		cwd: start.cwd,
		startedAt: start.startedAt,
		status: finish?.status ?? "interrupted",
		...(finish ? { finishedAt: finish.finishedAt, exitCode: finish.exitCode } : {}),
		...(finish?.stopReason ? { stopReason: finish.stopReason } : {}),
		...(finish?.errorMessage ? { errorMessage: finish.errorMessage } : {}),
		...(finish?.usage ? { usage: finish.usage } : {}),
		...(finish?.output ? { output: finish.output } : {}),
		...(finish?.artifactPath ? { artifactPath: finish.artifactPath } : {}),
	};
}

/** Read the branch into runs, newest first. */
function runsFromBranch(branch: readonly unknown[]): BackgroundRun[] {
	const starts = new Map<string, StartEntry>();
	const finishes = new Map<string, FinishEntry>();
	for (const raw of branch) {
		const entry = readEntry(raw);
		if (!entry) continue;
		if (entry.phase === "start") starts.set(entry.runId, entry);
		else finishes.set(entry.runId, entry);
	}
	const runs = [...starts.values()].map((start) => runFromEntries(start, finishes.get(start.runId)));
	return runs.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
}

/** The next `aN` id after every start entry on the branch. */
function nextId(branch: readonly unknown[], live: ReadonlyMap<string, BackgroundRun>): string {
	let max = 0;
	for (const raw of branch) {
		const entry = readEntry(raw);
		if (entry?.phase !== "start") continue;
		const match = /^a(\d+)$/.exec(entry.runId);
		if (match) max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
	}
	for (const id of live.keys()) {
		const match = /^a(\d+)$/.exec(id);
		if (match) max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
	}
	return `a${max + 1}`;
}

/** A background run that is still running in this process. */
interface LiveRun {
	controller: AbortController;
	run: BackgroundRun;
}

export function createBackgroundRuntime(deps: BackgroundDeps): BackgroundRuntime {
	const now = deps.now ?? (() => Date.now());
	const live = new Map<string, LiveRun>();
	const listeners = new Set<() => void>();
	let disposed = false;

	const notify = (): void => {
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				// A closed board must not break a run.
			}
		}
	};

	const runningCount = (): number => [...live.values()].filter((entry) => entry.run.status === "running").length;

	const finish = (id: string, result: SingleResult): void => {
		const entry = live.get(id);
		if (!entry || disposed) return;
		const status = statusOf(result);
		const output = finalOutput(result);
		const finishedAt = result.finishedAt ?? now();
		entry.run = {
			...entry.run,
			status,
			finishedAt,
			exitCode: result.exitCode,
			...(result.stopReason ? { stopReason: result.stopReason } : {}),
			...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
			usage: result.usage,
			output,
			...(result.artifactPath ? { artifactPath: result.artifactPath } : {}),
		};
		try {
			deps.appendEntry(BACKGROUND_ENTRY, {
				phase: "finish",
				runId: id,
				finishedAt,
				status,
				exitCode: result.exitCode,
				...(result.stopReason ? { stopReason: result.stopReason } : {}),
				...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
				usage: result.usage,
				output,
				...(result.artifactPath ? { artifactPath: result.artifactPath } : {}),
			} satisfies FinishEntry);
		} catch {
			// The live row still reflects the result; a failed append must not crash.
		}
		notify();
		try {
			deps.onFinish?.(entry.run);
		} catch {
			// A UI listener must not fail a finished run.
		}
	};

	const failStart = (id: string, error: unknown): void => {
		const entry = live.get(id);
		if (!entry || disposed) return;
		const message = error instanceof Error ? error.message : String(error);
		const result = createResult(entry.run.agent, entry.run.task);
		result.exitCode = 1;
		result.stderr = message;
		result.errorMessage = message;
		result.finishedAt = now();
		finish(id, result);
	};

	const start = (
		input: BackgroundStartInput,
		branch: readonly unknown[],
		depsRun: BackgroundRunDeps,
	): BackgroundStartResult => {
		if (disposed) return { ok: false, error: "The subagent session is shutting down." };
		const agent = depsRun.agents.find((candidate) => candidate.name === input.agent);
		if (!agent) return { ok: false, error: `Unknown agent: "${input.agent}".` };
		if (runningCount() >= depsRun.backgroundMax) {
			return {
				ok: false,
				error: `Too many background runs (${depsRun.backgroundMax}); wait for one to finish or cancel it.`,
			};
		}

		const id = nextId(branch, new Map([...live].map(([key, value]) => [key, value.run])));
		const cwd = input.cwd ? resolve(depsRun.defaultCwd, input.cwd) : depsRun.defaultCwd;
		const startedAt = now();
		const task = input.task.slice(0, MAX_TASK_CHARS);
		const record: BackgroundRun = {
			id,
			agent: input.agent,
			task,
			cwd,
			startedAt,
			status: "running",
		};
		const controller = new AbortController();
		live.set(id, { controller, run: record });
		try {
			deps.appendEntry(BACKGROUND_ENTRY, {
				phase: "start",
				runId: id,
				agent: input.agent,
				task,
				cwd,
				startedAt,
				...(agent.source ? { agentSource: agent.source } : {}),
				...(input.readOnly === true ? { readOnly: true } : {}),
			} satisfies StartEntry);
		} catch {
			live.delete(id);
			return { ok: false, error: "Could not record the background run." };
		}
		notify();

		Promise.resolve()
			.then(() =>
				depsRun.run({
					defaultCwd: depsRun.defaultCwd,
					defaults: depsRun.defaults,
					agentName: input.agent,
					agents: depsRun.agents,
					task,
					cwd: input.cwd,
					readOnly: input.readOnly,
					abortAsResult: true,
					signal: controller.signal,
					timeoutMs: depsRun.timeoutMs,
					transcripts: depsRun.transcripts,
					makeDetails: (results) => ({ mode: "single", results }),
					onUpdate: (partial) => {
						const current = partial.details?.results[0];
						if (!current) return;
						const entry = live.get(id);
						if (!entry) return;
						const preview = liveOutput(current);
						entry.run = {
							...entry.run,
							...(current.usage ? { usage: current.usage } : {}),
							...(preview ? { output: preview } : {}),
						};
						notify();
					},
				}),
			)
			.then((result) => finish(id, result))
			.catch((error) => failStart(id, error));

		return { ok: true, run: { ...record } };
	};

	const list = (branch: readonly unknown[]): BackgroundRun[] => {
		const byId = new Map(runsFromBranch(branch).map((run) => [run.id, run]));
		for (const [id, entry] of live) byId.set(id, entry.run);
		return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
	};

	const collect = (
		runId: string,
		branch: readonly unknown[],
	): { ok: true; text: string } | { ok: false; reason: string } => {
		const entry = live.get(runId);
		const run = entry?.run ?? runsFromBranch(branch).find((candidate) => candidate.id === runId);
		if (!run) return { ok: false, reason: `No background run ${runId}.` };
		if (run.status === "running") return { ok: false, reason: `${runId} is still running.` };
		if (run.status === "interrupted") return { ok: false, reason: `${runId} was interrupted before it finished.` };
		const output = run.output ?? "";
		const usage = run.usage ? formatUsageStats(run.usage) : "";
		const lines = [
			`Background subagent ${run.id} (${sanitizeLine(run.agent)}) ${run.status}.`,
			`Task: ${sanitizeLine(run.task)}`,
			`Cwd: ${sanitizeLine(run.cwd)}`,
			...(usage ? [`Usage: ${usage}`] : []),
			...(run.errorMessage ? [`Error: ${sanitizeLine(run.errorMessage)}`] : []),
			"",
			output || "(no output)",
		];
		if (run.artifactPath) lines.push("", `Transcript: ${run.artifactPath}`);
		return { ok: true, text: lines.join("\n") };
	};

	const cancel = (runId: string): boolean => {
		const entry = live.get(runId);
		if (!entry || entry.run.status !== "running") return false;
		entry.controller.abort();
		notify();
		return true;
	};

	const shutdown = (): void => {
		disposed = true;
		for (const entry of live.values()) entry.controller.abort();
		live.clear();
		listeners.clear();
	};

	const reset = (): void => {
		disposed = false;
		live.clear();
		listeners.clear();
	};

	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	return { start, list, collect, cancel, shutdown, reset, subscribe };
}

/** A human duration for a run; kept here so the board and collect agree. */
export function backgroundDuration(run: BackgroundRun, now = Date.now()): string {
	const end = run.finishedAt ?? now;
	return formatDuration(Math.max(0, end - run.startedAt));
}

/** Whether a run can be collected. */
export function canCollect(run: BackgroundRun): boolean {
	return run.status !== "running" && run.status !== "interrupted";
}
