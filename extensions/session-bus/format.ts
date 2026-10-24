/**
 * Model-facing text for the session bus.
 *
 * Everything that came from another session is untrusted text: it is sanitized
 * before it reaches the transcript, and paths/labels are rendered as one line.
 */

import { sanitizeLine } from "../../lib/format.ts";
import type { BusMessage, ClaimConflict, ClaimRecord, SessionStatus } from "./types.ts";
/** A short id suffix, neutralized like every other peer-supplied field. */
export function shortId(id: string): string {
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
		return `- ${label} (${shortId(session.id)}) · ${cwd} · ${sanitizeLine(session.mode)}${unread}`;
	});
	const claims = status.claims.map((claim) => `- ${claimLine(claim)}`);
	const alerts = status.watching ? [`Alerts: inbox watch on${status.watching.wake ? " (wake)" : ""}`] : [];
	const units = status.units ? [unitLine(status.units)] : [];
	return [
		`Sessions (${status.sessions.length})`,
		...(sessions.length > 0 ? sessions : ["- none"]),
		"",
		`Claims (${status.claims.length})`,
		...(claims.length > 0 ? claims : ["- none"]),
		...(units.length > 0 ? ["", ...units] : []),
		...(alerts.length > 0 ? ["", ...alerts] : []),
		"",
		`You: ${sanitizeLine(status.me.label)} (${shortId(status.me.id)})`,
	].join("\n");
}

/**
 * The newest split in this repository: joined over total, then each unit with
 * its holder. Peer-supplied labels are sanitized like every other field.
 */
function unitLine(units: NonNullable<SessionStatus["units"]>): string {
	const rows = units.rows.map(
		(row) => `${sanitizeLine(row.unit)}${row.lead ? " (lead)" : ""} · ${row.holder ? sanitizeLine(row.holder) : "—"}`,
	);
	return [
		`Units ${units.joined}/${units.total} joined · ${sanitizeLine(units.team)}`,
		...rows.map((row) => `- ${row}`),
	].join("\n");
}

/** The inbox-watch result. */
export function formatWatch(watching: { armed: boolean; wake: boolean }, name?: string): string {
	const owner = name ? ` for "${sanitizeLine(name)}"` : "";
	if (!watching.armed) return `Inbox watch off${owner}.`;
	return watching.wake
		? `Inbox watch on${owner}: a new message raises one turn.`
		: `Inbox watch on${owner}: new messages appear at your next turn.`;
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
		lines.push(`${sanitizeLine(conflict.path)} is owned by ${owner} (${shortId(conflict.owner)}).`);
	}
	return lines.length > 0 ? lines.join("\n") : "Nothing claimed.";
}

/** Join result: which unit, and what it claimed or could not. */
export function formatJoin(
	team: string,
	unit: string,
	claimed: readonly string[],
	conflicts: readonly ClaimConflict[],
): string {
	const where = `${sanitizeLine(team)}/${sanitizeLine(unit)}`;
	if (conflicts.length > 0) {
		return [`Could not join ${where}.`, ...formatClaim([], conflicts).split("\n").filter(Boolean)].join("\n");
	}
	const paths = claimed.map((path) => sanitizeLine(path)).join(", ");
	return claimed.length > 0 ? `Joined ${where}: claimed ${paths}.` : `Joined ${where}: nothing to claim.`;
}

/** Release result. */
export function formatRelease(released: readonly string[], notOwned: readonly string[]): string {
	const lines: string[] = [];
	if (released.length > 0) lines.push(`Released: ${released.map((path) => sanitizeLine(path)).join(", ")}.`);
	if (notOwned.length > 0) lines.push(`Not yours: ${notOwned.map((path) => sanitizeLine(path)).join(", ")}.`);
	return lines.length > 0 ? lines.join("\n") : "Nothing to release.";
}
