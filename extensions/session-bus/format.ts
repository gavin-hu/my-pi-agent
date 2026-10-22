/**
 * Model-facing text for the session bus.
 *
 * Everything that came from another session is untrusted text: it is sanitized
 * before it reaches the transcript, and paths/labels are rendered as one line.
 */

import { sanitize } from "../../lib/format.ts";
import type { BusMessage, ClaimConflict, ClaimRecord, SessionStatus } from "./types.ts";

function claimLine(claim: ClaimRecord): string {
	return `${claim.path} · ${claim.ownerLabel}`;
}

/** The status listing: sessions, unread counts, and claims. */
export function formatStatus(status: SessionStatus): string {
	const sessions = status.sessions.map((session) => {
		const unread = session.unread > 0 ? ` · ${session.unread} unread` : "";
		return `- ${session.label} (${session.id.slice(-6)}) · ${session.cwd} · ${session.mode}${unread}`;
	});
	const claims = status.claims.map((claim) => `- ${claimLine(claim)}`);
	return [
		`Sessions (${status.sessions.length})`,
		...(sessions.length > 0 ? sessions : ["- none"]),
		"",
		`Claims (${status.claims.length})`,
		...(claims.length > 0 ? claims : ["- none"]),
		"",
		`You: ${status.me.label} (${status.me.id.slice(-6)})`,
	].join("\n");
}

/** One consumed inbox, oldest first. */
export function formatInbox(messages: readonly BusMessage[]): string {
	if (messages.length === 0) return "Inbox empty.";
	return messages
		.map((message, index) => {
			const paths = message.paths?.length ? `\n   paths: ${message.paths.join(", ")}` : "";
			return `${index + 1}. ${message.fromLabel} · ${message.kind} · ${sanitize(message.text)}${paths}`;
		})
		.join("\n");
}

/** Confirmation for a send. */
export function formatSend(delivered: readonly string[], messageId: string): string {
	if (delivered.length === 0) return "Delivered to 0 sessions.";
	return `Delivered to ${delivered.join(", ")} (${messageId}).`;
}

/** Claim result, including the owner that blocked it. */
export function formatClaim(claimed: readonly string[], conflicts: readonly ClaimConflict[]): string {
	const lines: string[] = [];
	if (claimed.length > 0) lines.push(`Claimed: ${claimed.join(", ")}.`);
	for (const conflict of conflicts) {
		lines.push(`${conflict.path} is owned by ${conflict.ownerLabel} (${conflict.owner.slice(-6)}).`);
	}
	return lines.length > 0 ? lines.join("\n") : "Nothing claimed.";
}

/** Release result. */
export function formatRelease(released: readonly string[], notOwned: readonly string[]): string {
	const lines: string[] = [];
	if (released.length > 0) lines.push(`Released: ${released.join(", ")}.`);
	if (notOwned.length > 0) lines.push(`Not yours: ${notOwned.join(", ")}.`);
	return lines.length > 0 ? lines.join("\n") : "Nothing to release.";
}
