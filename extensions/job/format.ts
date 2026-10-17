/**
 * Pure text/format helpers for the jobs extension.
 *
 * No host APIs and no theme logic beyond `Theme` colour helpers: these turn job
 * state and raw log bytes into short, terminal-safe strings for the status
 * chip, the `/jobs` screen, the transcript, and the model.
 *
 * Raw log output is untrusted: it can contain ANSI escapes, carriage-return
 * progress rewrites, and control characters. Every boundary that surfaces log
 * text goes through `sanitizeLogLine`/`sanitizeLogText`, which strip those so a
 * background process cannot restyle or corrupt the terminal. The raw log file
 * is never modified.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { GLYPHS, SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint, type TuiRole } from "../../lib/tui/tokens.ts";
import type { JobRecord, JobStatus } from "./types.ts";

/** Longest sanitized log line kept for display; longer lines are clipped. */
const MAX_LOG_LINE = 200;

/** Longest label shown in the transcript or `/jobs` screen. */
const MAX_DISPLAY_LABEL = 48;

/** ESC-introduced sequences: OSC, CSI, and single-character escapes. */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESC = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Remove ANSI/OSC escape sequences and control characters from one line. */
function stripEscapes(raw: string): string {
	return raw.replace(OSC, "").replace(CSI, "").replace(OTHER_ESC, "");
}

/**
 * Make one line of untrusted log output safe to render.
 *
 * Resolves carriage returns the way a terminal would (keep the text after the
 * last `\r`, so progress rewrites collapse to their final state), strips
 * escapes and control characters, collapses whitespace, and clips the result.
 */
export function sanitizeLogLine(raw: string): string {
	const withoutAnsi = stripEscapes(raw);
	const afterCr = withoutAnsi.slice(withoutAnsi.lastIndexOf("\r") + 1);
	const cleaned = afterCr.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	return cleaned.length > MAX_LOG_LINE ? `${cleaned.slice(0, MAX_LOG_LINE - 1)}…` : cleaned;
}

/** Sanitize a block of log text line by line. */
export function sanitizeLogText(raw: string): string[] {
	return raw.split("\n").map(sanitizeLogLine);
}

/** The last `count` entries of `lines`. */
export function tailLines(lines: string[], count: number): string[] {
	if (count <= 0) return [];
	return lines.slice(Math.max(0, lines.length - count));
}

/** Compact duration: `450ms`, `3.2s`, `1m05s`, `2h03m`. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** Elapsed time for a job: running jobs measure to now, finished jobs to their end. */
export function elapsedMs(job: JobRecord, now: number): number {
	return (job.finishedAt ?? now) - job.startedAt;
}

/** The design role a job status is drawn in. */
export function statusRole(status: JobStatus): TuiRole {
	switch (status) {
		case "exited":
			return "ok";
		case "failed":
			return "bad";
		case "killed":
			return "meta";
		case "unknown":
			return "faint";
		default:
			return "accent";
	}
}

/** Width-1 glyph for a status, from the shared vocabulary. */
export function statusGlyphChar(status: JobStatus): string {
	switch (status) {
		case "exited":
			return GLYPHS.check;
		case "failed":
			return GLYPHS.jobsFailure;
		case "killed":
			return GLYPHS.killed;
		case "unknown":
			return GLYPHS.unknown;
		default:
			return GLYPHS.jobsRunning;
	}
}

/** Width-1 themed glyph for a status. */
export function statusGlyph(status: JobStatus, theme: Theme): string {
	return paint(theme, statusRole(status), statusGlyphChar(status));
}

/** Short status word for text output. */
function statusWord(job: JobRecord): string {
	if (job.status === "failed" && job.exitCode !== null) return `failed (exit ${job.exitCode})`;
	return job.status;
}

/** A label clipped to one safe display line. */
export function clipLabel(text: string): string {
	return truncateToWidth(sanitizeLogLine(text), MAX_DISPLAY_LABEL, "…");
}

/** A job's label (falling back to its command) clipped to one safe display line. */
export function shortLabel(job: JobRecord): string {
	return clipLabel(job.label || job.command);
}

/** One-line job summary shared by the model output and the `/jobs` screen. */
function jobSummary(job: JobRecord, now: number, ownSessionId?: string): string {
	const parts = [`${job.id}`, statusWord(job), formatDuration(elapsedMs(job, now))];
	if (job.status === "running" && job.pid) parts.push(`pid ${job.pid}`);
	parts.push(shortLabel(job));
	// A peer session's job is shown but belongs to it: name the owner so the
	// `clear` refusal reads as intent rather than a bug.
	if (ownSessionId !== undefined && job.sessionId !== ownSessionId) parts.push("(another session)");
	return parts.join("  ");
}

/** Model-facing list of jobs, or a note when there are none. */
export function formatJobList(jobs: JobRecord[], now = Date.now(), ownSessionId?: string): string {
	if (jobs.length === 0) return "No jobs.";
	const lines = jobs.map((job) => `  ${jobSummary(job, now, ownSessionId)}`);
	return `Jobs (${jobs.length}):\n${lines.join("\n")}`;
}

/** Model-facing detail for one job, including its last output line. */
export function formatJobStatus(job: JobRecord, now = Date.now(), ownSessionId?: string): string {
	const lines = [
		`${job.id}: ${statusWord(job)}`,
		`command: ${sanitizeLogLine(job.command)}`,
		`cwd: ${sanitizeLogLine(job.cwd)}`,
		`elapsed: ${formatDuration(elapsedMs(job, now))}`,
	];
	if (job.pid) lines.push(`pid: ${job.pid}`);
	if (job.logPath) lines.push(`log: ${sanitizeLogLine(job.logPath)}`);
	if (ownSessionId !== undefined && job.sessionId !== ownSessionId) lines.push("session: another session");
	if (job.lastLine) lines.push(`last: ${job.lastLine}`);
	return lines.join("\n");
}

/** Model-facing render of a sanitized log tail. */
export function formatLogs(job: JobRecord, lines: string[], maxChars: number): { text: string; truncated: boolean } {
	if (lines.length === 0) {
		return { text: `${job.id}: no output yet${job.logPath ? ` (log: ${job.logPath})` : ""}.`, truncated: false };
	}
	let body = lines.join("\n");
	let truncated = false;
	if (body.length > maxChars) {
		body = body.slice(body.length - maxChars);
		truncated = true;
	}
	const suffix = truncated ? `\n… truncated; full log: ${job.logPath}` : "";
	return { text: `${job.id} (${statusWord(job)}) output:\n${body}${suffix}`, truncated };
}

/** One-line summary of a completed job, for context injection and wake messages. */
export function formatCompletion(job: JobRecord, now = Date.now()): string {
	const tail = job.lastLine ? ` — ${job.lastLine}` : "";
	return `${job.id} ${statusWord(job)} after ${formatDuration(elapsedMs(job, now))} (${shortLabel(job)})${tail}`;
}

/** Transcript call text for the `job` tool. */
export function formatCallText(action: string, args: Record<string, unknown>, argsComplete = true): string {
	const target = typeof args.id === "string" && args.id ? sanitizeLogLine(args.id) : undefined;
	switch (action) {
		case "start": {
			const command = typeof args.command === "string" ? sanitizeLogLine(args.command.trim()) : "";
			if (!command) return argsComplete ? "start" : "start …";
			const preview = truncateToWidth(command, MAX_DISPLAY_LABEL, "…");
			return `start → ${preview}`;
		}
		case "kill":
			return `kill ${target ?? ""}`.trim();
		case "send": {
			if (!target) return "send";
			const input = typeof args.input === "string" ? sanitizeLogLine(args.input) : "";
			const preview = input ? truncateToWidth(input, MAX_DISPLAY_LABEL, "…") : "";
			const parts = [preview, args.eof === true ? "EOF" : ""].filter(Boolean).join(" + ");
			return parts ? `send ${target} → ${parts}` : `send ${target}`;
		}
		case "logs":
		case "status":
		case "wait":
			return `${action} ${target ?? ""}`.trim();
		case "clear":
			return args.all ? "clear all" : `clear ${target ?? "finished"}`.trim();
		default:
			return action;
	}
}

/** Order jobs for display: running first, then by most recent start. */
export function compareJobs(a: JobRecord, b: JobRecord): number {
	const rank = (job: JobRecord): number => (job.status === "running" ? 0 : 1);
	return rank(a) - rank(b) || b.startedAt - a.startedAt;
}

export interface JobCounts {
	total: number;
	running: number;
	failed: number;
}

/** One-pass status counts for the `/jobs` summary. */
export function jobCounts(jobs: Iterable<JobRecord>): JobCounts {
	let total = 0;
	let running = 0;
	let failed = 0;
	for (const job of jobs) {
		total++;
		if (job.status === "running") running++;
		else if (job.status === "failed") failed++;
	}
	return { total, running, failed };
}

/** Finished failures whose completion has not been reported to the model yet. */
export function pendingFailures(jobs: Iterable<JobRecord>): JobRecord[] {
	return [...jobs].filter((job) => !job.seen && job.status === "failed");
}

/** Short outcome word for a job: pid while running, else exit code or signal. */
export function jobOutcome(job: JobRecord): string {
	switch (job.status) {
		case "running":
			return job.pid !== null ? `pid ${job.pid}` : "running";
		case "exited":
			return `exit ${job.exitCode ?? 0}`;
		case "failed":
			return job.exitCode !== null ? `exit ${job.exitCode}` : "failed";
		case "killed":
			return job.signal ?? "killed";
		default:
			return "—";
	}
}

/** One-line outcome for a single job, themed for the transcript result. */
export function formatJobOutcomeLine(job: JobRecord, theme: Theme, now = Date.now()): string {
	const sep = paint(theme, "faint", SEPARATORS.item);
	const outcome =
		job.status === "failed" ? paint(theme, "bad", jobOutcome(job)) : paint(theme, "faint", jobOutcome(job));
	return (
		statusGlyph(job.status, theme) +
		" " +
		paint(theme, "accent", job.id) +
		" " +
		paint(theme, "meta", shortLabel(job)) +
		sep +
		outcome +
		sep +
		paint(theme, "faint", formatDuration(elapsedMs(job, now)))
	);
}

/** Unstyled, sanitized detail lines for the `/jobs` focus pane. */
export function formatJobDetail(job: JobRecord, now = Date.now(), ownSessionId?: string): string[] {
	const lines = [
		sanitizeLogLine(`command: ${job.command}`),
		sanitizeLogLine(`cwd: ${job.cwd} · ${jobOutcome(job)} · ${formatDuration(elapsedMs(job, now))}`),
	];
	if (ownSessionId !== undefined && job.sessionId !== ownSessionId) lines.push("owner: another session");
	const last = sanitizeLogLine(job.lastLine);
	if (last) lines.push(`last: ${last}`);
	return lines;
}
