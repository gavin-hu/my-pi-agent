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

/**
 * A body clipped for the model, with the ellipsis that says so.
 *
 * One rule for the two surfaces that hand a model a message body — the mail notice and
 * an inbox read — because a clip that differed between them would show less of a
 * message when it was asked for than when it was announced.
 */
export function clipText(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * A handoff is an instruction rather than a notification, so the model reads this much of
 * it in the notice and in the inbox: the card, its paths, and the step to take all sit
 * past the point where a message preview stops.
 */
export const HANDOFF_PREVIEW = 800;

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

/** A message body in an inbox read: twice the notice's preview, because this is where mail is read. */
export const INBOX_BODY = 400;

/** A handoff in an inbox read, never less than the notice already showed. */
export const INBOX_HANDOFF = HANDOFF_PREVIEW;

/**
 * The whole read is bounded, at one message's maximum body: `inbox` is the surface the
 * prompt tells the model to run, so it is also the largest thing the bus can put in a
 * context. A burst of 4,000-character bodies is 80,000 characters at the default limit and
 * 200,000 at the maximum; a notice of the same burst is 1,200.
 */
export const INBOX_BUDGET = 4_000;

/** One inbox read: the text the model reads, and how many messages it covers. */
export interface InboxRead {
	text: string;
	shown: number;
}

/** One message as a numbered line, its body clipped and its paths on a second line. */
function inboxLine(message: BusMessage, index: number): string {
	const paths = message.paths?.length
		? `\n   paths: ${message.paths.map((path) => sanitizeLine(path)).join(", ")}`
		: "";
	const from = sanitizeLine(message.fromLabel);
	const body = clipText(sanitizeLine(message.text), message.kind === "handoff" ? INBOX_HANDOFF : INBOX_BODY);
	return `${index + 1}. ${from} · ${sanitizeLine(message.kind)} · ${body}${paths}`;
}

/**
 * One consumed inbox, oldest first and bounded.
 *
 * Every body is clipped, and the read stops at `INBOX_BUDGET`, so a burst costs a known
 * amount of context instead of the sum of its bodies. The messages past that point are
 * named rather than rendered, and `shown` is what the caller may consume — the tail is
 * true because the mail behind it is left in the inbox for the next read. The first
 * message is rendered whatever its size: a cap that showed nothing would leave a caller
 * holding unread mail it can neither see nor name.
 *
 * `waiting` is the mail outside this window for another reason — the caller's `limit`, or
 * mail the caller did not load — and it is counted into the same tail, because it is the
 * same instruction back. It is not clamped here: the caller counts the inbox, not the
 * window it happened to read, so a burst past the peek's own cap is named whole.
 */
export function formatInbox(messages: readonly BusMessage[], waiting = 0): InboxRead {
	if (messages.length === 0) return { text: "Inbox empty.", shown: 0 };
	const lines: string[] = [];
	let used = 0;
	for (const message of messages) {
		const line = inboxLine(message, lines.length);
		if (lines.length > 0 && used + line.length > INBOX_BUDGET) break;
		lines.push(line);
		used += line.length + 1;
	}
	const shown = lines.length;
	const more = messages.length - shown + waiting;
	if (more > 0) lines.push(`… ${more} more in the inbox — run \`inbox\` again.`);
	return { text: lines.join("\n"), shown };
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
