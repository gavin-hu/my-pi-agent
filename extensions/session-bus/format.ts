/**
 * Model-facing text for the session bus.
 *
 * Everything that came from another session is untrusted text: it is sanitized
 * before it reaches the transcript, and paths/labels are rendered as one line.
 */

import { sanitizeLine } from "../../lib/format.ts";
import type { BusMessage, ClaimConflict, ClaimRecord, SessionStatus } from "./types.ts";
/**
 * The last few characters of a peer's id, as the transcript shows it.
 *
 * Neutralized like every other peer-supplied field, and deliberately not
 * `lib/session-label.ts`'s `shortId`: that one keeps the id's alphanumerics to
 * build a default *label*, while this one is the id's own tail, sanitized for a
 * row.
 */
export function idSuffix(id: string): string {
	return sanitizeLine(id.slice(-6));
}

function claimLine(claim: ClaimRecord): string {
	return `${sanitizeLine(claim.path)} · ${sanitizeLine(claim.ownerLabel)}`;
}

/** The status listing: sessions, unread counts, claims, and this session's alerts. */
export function formatStatus(status: SessionStatus): string {
	const sessions = status.sessions.map((session) => {
		const unread = session.unread > 0 ? ` · ${session.unread} unread` : "";
		const label = sanitizeLine(session.label);
		const cwd = sanitizeLine(session.cwd);
		return `- ${label} (${idSuffix(session.id)}) · ${cwd} · ${sanitizeLine(session.mode)}${unread}`;
	});
	const claims = status.claims.map((claim) => `- ${claimLine(claim)}`);
	const alerts = status.watching ? [`Alerts: inbox watch on${status.watching.wake ? " (wake)" : ""}`] : [];
	return [
		`Sessions (${status.sessions.length})`,
		...(sessions.length > 0 ? sessions : ["- none"]),
		"",
		`Claims (${status.claims.length})`,
		...(claims.length > 0 ? claims : ["- none"]),
		...(alerts.length > 0 ? ["", ...alerts] : []),
		"",
		`You: ${sanitizeLine(status.me.label)} (${idSuffix(status.me.id)})${status.onBus ? "" : " \u00b7 not on the bus yet \u2014 `session join` puts you on it"}`,
	].join("\n");
}

/**
 * The join result: the label peers address, and whether mail will reach this session.
 *
 * One sentence for one act, because `join` is one action — the name and the watch are
 * two facts about the same decision, and a reader that had to ask twice would be reading
 * a bus the user is not supposed to operate.
 */
export function formatJoin(label: string, watching: { armed: boolean; wake: boolean }): string {
	const who = `On the bus as "${sanitizeLine(label)}"`;
	if (!watching.armed) return `${who}, not listening: mail waits in the inbox.`;
	return watching.wake
		? `${who}, listening: a new message raises one turn.`
		: `${who}, listening: new messages appear at your next turn.`;
}

/** One consumed inbox, oldest first. */
export function formatInbox(messages: readonly BusMessage[]): string {
	if (messages.length === 0) return "Inbox empty.";
	return messages
		.map((message, index) => {
			const paths = message.paths?.length
				? `\n   paths: ${message.paths.map((path) => sanitizeLine(path)).join(", ")}`
				: "";
			const from = sanitizeLine(message.fromLabel);
			return `${index + 1}. ${from} · ${sanitizeLine(message.kind)} · ${sanitizeLine(message.text)}${paths}`;
		})
		.join("\n");
}

/** Confirmation for a send. */
export function formatSend(delivered: readonly string[], messageId: string): string {
	if (delivered.length === 0) return "Delivered to 0 sessions.";
	const names = delivered.map((label) => sanitizeLine(label)).join(", ");
	return `Delivered to ${names} (${sanitizeLine(messageId)}).`;
}

/** Claim result, including the owner that blocked it. */
export function formatClaim(claimed: readonly string[], conflicts: readonly ClaimConflict[]): string {
	const lines: string[] = [];
	if (claimed.length > 0) lines.push(`Claimed: ${claimed.map((path) => sanitizeLine(path)).join(", ")}.`);
	for (const conflict of conflicts) {
		const owner = sanitizeLine(conflict.ownerLabel);
		lines.push(`${sanitizeLine(conflict.path)} is owned by ${owner} (${idSuffix(conflict.owner)}).`);
	}
	return lines.length > 0 ? lines.join("\n") : "Nothing claimed.";
}

/** Release result. */
export function formatRelease(released: readonly string[], notOwned: readonly string[]): string {
	const lines: string[] = [];
	if (released.length > 0) lines.push(`Released: ${released.map((path) => sanitizeLine(path)).join(", ")}.`);
	if (notOwned.length > 0) lines.push(`Not yours: ${notOwned.map((path) => sanitizeLine(path)).join(", ")}.`);
	return lines.length > 0 ? lines.join("\n") : "Nothing to release.";
}
