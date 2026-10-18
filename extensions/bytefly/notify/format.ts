/**
 * Notification text for each trigger.
 *
 * Pure string builders: the register module owns when to fire, this owns what
 * the notification says. Every argument that can carry model- or user-authored
 * text is sanitized here, so no control character reaches {@link sendNotification}
 * from a turn, a prompt title, or a job label.
 */

import { basename } from "node:path";
import type { JobFinishedEvent, WatchMatchEvent } from "../../../lib/events.ts";
import { sanitizeLine } from "../../../lib/format.ts";

/** A short session label, so concurrent unattended runs can be told apart. */
export function sessionLabel(name: string | undefined, cwd: string): string {
	const named = sanitizeLine(name ?? "");
	if (named) return named;
	const folder = basename(cwd.replace(/[\\/]+$/, ""));
	return sanitizeLine(folder) || "session";
}

/** Body for a settled turn: Pi finished and waits for the next message. */
export function formatTurnBody(session: string): string {
	return `Turn finished · ${session}`;
}

/** Body for a prompt the agent opened mid-run: it is asking for input. */
export function formatInputBody(kind: string, title: string | undefined, session: string): string {
	const detail = sanitizeLine(title ?? "");
	return `Waiting for input (${sanitizeLine(kind)})${detail ? `: ${detail}` : ""} · ${session}`;
}

/** Body for a finished background job. */
export function formatJobBody(job: JobFinishedEvent): string {
	const verb = job.status === "failed" ? "failed" : job.status === "killed" ? "was killed" : "finished";
	const code = job.status === "failed" && job.exitCode !== null ? ` (${job.exitCode})` : "";
	const label = sanitizeLine(job.label);
	return `Job ${job.id} ${verb}${code}${label ? ` · ${label}` : ""}`;
}

/** How much of a matched line an OS notification carries. */
export const MAX_WATCH_LINE = 80;

/**
 * Body for a `watch` wake match: the newest line that matched, and how many did.
 *
 * The line is watched output rather than something this package wrote, so it is
 * sanitized and clipped here — the one place a notification's text is shaped.
 */
export function formatWatchBody(event: WatchMatchEvent): string {
	const count = Math.max(1, event.count);
	const label = sanitizeLine(event.label);
	const line = sanitizeLine(event.line).slice(0, MAX_WATCH_LINE).trimEnd();
	const head = `${count} watched line${count === 1 ? "" : "s"} matched`;
	const source = `${sanitizeLine(event.watcherId)}${label ? ` ${label}` : ""}`;
	return line ? `${head} · ${source}: ${line}` : `${head} · ${source}`;
}
