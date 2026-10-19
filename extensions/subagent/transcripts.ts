/**
 * Opt-in per-run transcripts.
 *
 * The dispatching process writes these; a child never learns that one exists, so
 * the read-only tool set and the project-agent trust gate stay exactly as strict
 * as they are. Lines are buffered in memory up to {@link MAX_TRANSCRIPT_BYTES}
 * and flushed once at the end of the run, which keeps the store ordered without a
 * stream to close and still writes on the abort path.
 *
 * Every failure is reported, never thrown: an unwritable checkout must not fail a
 * delegation that already did its work.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { repoRootFor } from "../../lib/git/index.ts";
import type { SingleResult } from "./types.ts";

/** Ceiling for one run's buffered transcript, stdout and stderr together. */
export const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

/** `YYYYMMDD-HHMMSS-abcdef`; a name sort is chronological, so pruning never parses one. */
const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

const EVENTS_FILE = "events.jsonl";
const STDERR_FILE = "stderr.log";
const META_FILE = "meta.json";

/** What a transcript needs from the run that produced it. */
export interface TranscriptContext {
	/** Working directory the child ran in. */
	cwd: string;
	/** Whether the run forced a reader-only tool set. */
	readOnly: boolean;
}

/** The outcome of writing one run directory. */
export interface TranscriptWritten {
	/** Directory written, absent when the write failed. */
	path?: string;
	/** Bytes buffered for this run. */
	bytes: number;
	/** Whether the size cap cut the transcript short. */
	truncated: boolean;
	/** Why the write failed, when it did. */
	error?: string;
}

/** A run's buffered transcript, written once the run has finished. */
export interface Transcript {
	/** Append one raw stdout line. */
	line(raw: string): void;
	/** Append stderr text, which may arrive in partial chunks. */
	stderr(text: string): void;
	/** Write the run directory under `dir`. Never throws. */
	write(dir: string, result: SingleResult, context: TranscriptContext): TranscriptWritten;
}

/** The directory holding every transcript for `cwd`'s repository. */
export async function transcriptsDirFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<string> {
	const root = await repoRootFor(pi, cwd, 5_000);
	return root ? join(root, CONFIG_DIR_NAME, "subagents") : join(getAgentDir(), "subagents");
}

/** A run id for `at` (epoch ms, rendered in UTC) with a six-hex suffix. */
export function runIdFor(at: number, suffix: string): string {
	const date = new Date(at);
	const pad = (value: number, width = 2) => String(value).padStart(width, "0");
	const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
	const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
	return `${day}-${time}-${suffix}`;
}

/** The metadata written beside a run's stream; enough to audit it without one. */
function metaFor(runId: string, result: SingleResult, context: TranscriptContext, truncated: boolean) {
	return {
		version: 1,
		runId,
		agent: result.agent,
		agentSource: result.agentSource,
		task: result.task,
		step: result.step,
		cwd: context.cwd,
		readOnly: context.readOnly,
		provider: result.provider,
		model: result.model,
		startedAt: result.startedAt,
		finishedAt: result.finishedAt,
		exitCode: result.exitCode,
		timedOut: result.timedOut === true,
		stopReason: result.stopReason,
		errorMessage: result.errorMessage,
		toolErrors: result.toolErrors ?? 0,
		usage: result.usage,
		transcript: { truncated },
	};
}

/** Buffer one run's stream until it finishes. */
export function createTranscript(options: { maxBytes?: number } = {}): Transcript {
	const maxBytes = options.maxBytes ?? MAX_TRANSCRIPT_BYTES;
	const lines: string[] = [];
	let stderr = "";
	let bytes = 0;
	let truncated = false;

	const append = (text: string, kind: "line" | "stderr"): void => {
		if (truncated || !text) return;
		const size = Buffer.byteLength(text);
		if (bytes + size > maxBytes) {
			// Stop growing; the marker is added on write so the file stays parseable.
			truncated = true;
			return;
		}
		bytes += size;
		if (kind === "line") lines.push(text);
		else stderr += text;
	};

	return {
		line: (raw) => append(raw, "line"),
		stderr: (text) => append(text, "stderr"),

		write(dir, result, context) {
			const runId = runIdFor(result.startedAt ?? Date.now(), randomBytes(3).toString("hex"));
			const runDir = join(dir, runId);
			try {
				mkdirSync(runDir, { recursive: true });
				const body = truncated ? [...lines, JSON.stringify({ type: "transcript-truncated", bytes })] : lines;
				if (body.length > 0) writeFileSync(join(runDir, EVENTS_FILE), `${body.join("\n")}\n`, { mode: 0o600 });
				if (stderr) writeFileSync(join(runDir, STDERR_FILE), stderr, { mode: 0o600 });
				// Written last: a directory without metadata is an interrupted write.
				const meta = `${JSON.stringify(metaFor(runId, result, context, truncated), null, 2)}\n`;
				writeFileSync(join(runDir, META_FILE), meta, { mode: 0o600 });
				return { path: runDir, bytes, truncated };
			} catch (error) {
				return {
					bytes,
					truncated,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};
}

/** Which run directories a prune keeps and which it removes. */
export interface PruneOutcome {
	removed: string[];
	/** Runs still on disk after the prune. */
	kept: number;
}

/**
 * Remove aged and surplus run directories. Only names matching a run id are
 * candidates, so an unrelated directory under the store is never touched.
 */
export function pruneTranscripts(
	dir: string,
	options: { retentionDays: number; maxRuns: number; now?: number },
): PruneOutcome {
	const now = options.now ?? Date.now();
	let names: string[];
	try {
		names = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return { removed: [], kept: 0 };
	}

	const kept: string[] = [];
	const stale: string[] = [];
	for (const name of names) {
		let modified: number;
		try {
			modified = statSync(join(dir, name)).mtimeMs;
		} catch {
			continue;
		}
		if (now - modified > options.retentionDays * 86_400_000) stale.push(name);
		else kept.push(name);
	}
	while (kept.length > options.maxRuns) {
		const oldest = kept.shift();
		if (oldest) stale.push(oldest);
	}

	const removed: string[] = [];
	for (const name of stale) {
		try {
			rmSync(join(dir, name), { recursive: true, force: true });
			removed.push(name);
		} catch {
			// Best-effort: a locked directory is retried at the next session start.
		}
	}
	return { removed, kept: kept.length };
}
