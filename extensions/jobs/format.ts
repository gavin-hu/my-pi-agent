/**
 * Pure text/format helpers for the jobs extension.
 *
 * No host APIs and no theme logic beyond `Theme` colour helpers: these turn job
 * state and raw log bytes into short, terminal-safe strings for the widget, the
 * `/jobs` screen, the transcript, and the model.
 *
 * Raw log output is untrusted: it can contain ANSI escapes, carriage-return
 * progress rewrites, and control characters. Every boundary that surfaces log
 * text goes through `sanitizeLogLine`/`sanitizeLogText`, which strip those so a
 * background process cannot restyle or corrupt the terminal. The raw log file
 * is never modified.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { JobRecord, JobStatus } from "./types.ts";

/** Longest sanitized log line kept for display; longer lines are clipped. */
export const MAX_LOG_LINE = 200;

/** Longest label shown in the widget or transcript. */
const MAX_LABEL = 48;

/** ESC-introduced sequences: OSC, CSI, and single-character escapes. */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESC = /\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Remove ANSI/OSC escape sequences and control characters from one line. */
export function stripEscapes(raw: string): string {
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

/** Width-1 themed glyph for a status. */
export function statusGlyph(status: JobStatus, theme: Theme): string {
	switch (status) {
		case "exited":
			return theme.fg("success", "✓");
		case "failed":
			return theme.fg("error", "✕");
		case "killed":
			return theme.fg("muted", "◌");
		case "unknown":
			return theme.fg("dim", "?");
		default:
			return theme.fg("accent", "▸");
	}
}

/** Short status word for text output. */
export function statusWord(job: JobRecord): string {
	if (job.status === "failed" && job.exitCode !== null) return `failed (exit ${job.exitCode})`;
	return job.status;
}

/** A label clipped to one safe display line. */
export function shortLabel(job: JobRecord): string {
	const label = sanitizeLogLine(job.label || job.command);
	return truncateToWidth(label, MAX_LABEL, "…");
}

/** One-line job summary shared by the model output and the widget. */
export function jobSummary(job: JobRecord, now: number): string {
	const parts = [`${job.id}`, statusWord(job), formatDuration(elapsedMs(job, now))];
	if (job.status === "running" && job.pid) parts.push(`pid ${job.pid}`);
	parts.push(shortLabel(job));
	return parts.join("  ");
}

/** Model-facing list of jobs, or a note when there are none. */
export function formatJobList(jobs: JobRecord[], now = Date.now()): string {
	if (jobs.length === 0) return "No jobs.";
	const lines = jobs.map((job) => `  ${jobSummary(job, now)}`);
	return `Jobs (${jobs.length}):\n${lines.join("\n")}`;
}

/** Model-facing detail for one job, including its last output line. */
export function formatJobStatus(job: JobRecord, now = Date.now()): string {
	const lines = [
		`${job.id}: ${statusWord(job)}`,
		`command: ${sanitizeLogLine(job.command)}`,
		`cwd: ${sanitizeLogLine(job.cwd)}`,
		`elapsed: ${formatDuration(elapsedMs(job, now))}`,
	];
	if (job.pid) lines.push(`pid: ${job.pid}`);
	if (job.logPath) lines.push(`log: ${sanitizeLogLine(job.logPath)}`);
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
	const target = typeof args.id === "string" && args.id ? args.id : undefined;
	switch (action) {
		case "start": {
			const command = typeof args.command === "string" ? args.command.trim() : "";
			if (!command) return argsComplete ? "start" : "start …";
			const preview = truncateToWidth(command, MAX_LABEL, "…");
			return `start → ${preview}`;
		}
		case "kill":
			return `kill ${target ?? ""}`.trim();
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
