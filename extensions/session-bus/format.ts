/**
 * The words the session bus prints: what the model reads, and the message grammar every surface
 * shares.
 *
 * Everything that came from another session is untrusted text: it is sanitized here, at the boundary
 * that builds the sentence, and paths and labels are rendered as one line. Three of those words are
 * needed by audiences that style them differently — the transcript rows, the notice, the board's
 * screen — so `messageMeta`, `messagePaths` and `ageText` live here rather than in whichever module
 * drew a line first. What a surface keeps is its frame: a row trails the meta, the notice
 * parenthesises the paths, the screen prefixes them.
 */

import { ageWords, clipText, formatAge, sanitizeLine } from "../../lib/format.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { shortId } from "./protocol.ts";
import type { BusMessage, ClaimConflict, ClaimRecord, DropResult, SessionStatus, UnaccountedPage } from "./types.ts";
/** The separator as a glyph, for the scan that neutralizes it inside a value. */
const SEPARATOR_GLYPH = SEPARATORS.item.trim();

/**
 * One field of the meta grammar.
 *
 * Sanitized like any other text another session wrote, and with the separator taken out: the kind is
 * an enum and `replyTo` is on the reference alphabet, but a label is only closed up to one line
 * (`normalizeLabel`) and `about` is the sender's own spelling — so those two can hold the glyph,
 * and either would otherwise read as a field it is not. Exported because the notice builds the same
 * `label · kind` pair and must not answer the question differently.
 */
export function metaField(value: string): string {
	return sanitizeLine(value.split(SEPARATOR_GLYPH).join(""));
}

/** The sender and the kind, and the references the message carries: `api-core · handoff`. */
export function messageMeta(message: BusMessage): string {
	const answered = message.replyTo === undefined ? "" : `${SEPARATORS.item}re: ${metaField(message.replyTo)}`;
	const about = message.about === undefined ? "" : `${SEPARATORS.item}about: ${metaField(message.about)}`;
	return `${metaField(message.fromLabel)}${SEPARATORS.item}${sanitizeLine(message.kind)}${answered}${about}`;
}

/** The paths a message carries, sanitized and joined, or an empty string when it names none. */
export function messagePaths(message: BusMessage): string {
	return message.paths?.length ? message.paths.map((path) => sanitizeLine(path)).join(", ") : "";
}

/**
 * How long ago something was, in the words every surface prints: `just now`, `3m ago`, `2h ago`.
 *
 * `lib/format.ts`'s `formatAge` decides the number and the unit (`now` inside 45 seconds, then `3m`,
 * `2h`, `2d`) and its `ageWords` says what a reader is told about it; this is the bus's one call
 * over both, for the text it builds from two numbers rather than from an age it already has.
 */
export function ageText(now: number, at: number): string {
	return ageWords(formatAge(now, at));
}

/**
 * A handoff is an instruction rather than a notification, so the notice reads this much of
 * it: the card, its paths, and the step to take all sit past the point where a message
 * preview stops.
 */
export const HANDOFF_PREVIEW = 800;

function claimLine(claim: ClaimRecord): string {
	return `${sanitizeLine(claim.path)} · ${sanitizeLine(claim.ownerLabel)}`;
}

/**
 * The status listing: sessions, unread counts, claims, and this session's alerts.
 *
 * `now` is the clock the unaccounted ages are read with, passed rather than reached for: a sentence
 * that says `3h` is a fact about two numbers, and a test that could not pin them could not hold it.
 */
export function formatStatus(status: SessionStatus, now: number): string {
	const sessions = status.sessions.map((session) => {
		const unread = session.unread > 0 ? ` · ${session.unread} unread` : "";
		const label = sanitizeLine(session.label);
		const cwd = sanitizeLine(session.cwd);
		return `- ${label} (${shortId(session.id)}) · ${cwd} · ${sanitizeLine(session.mode)}${unread}`;
	});
	const claims = status.claims.map((claim) => `- ${claimLine(claim)}`);
	const alerts = status.watching ? [`Alerts: inbox watch on${status.watching.wake ? " (wake)" : ""}`] : [];
	// Mail no record accounts for has no session row to sit under, so it is named once, under the
	// sessions it is missing from. A bus where every message has a record draws nothing here.
	const unaccounted = status.unaccounted ? unaccountedLines(status.unaccounted, now) : [];
	// A file this build cannot read is inside the count above and can never leave it except by its
	// TTL, so the read that parsed it names it: a number nobody can act on is worse than a name.
	const refused = unreadableText(status.unreadable ?? []);
	return [
		`Sessions (${status.sessions.length})`,
		...(sessions.length > 0 ? sessions : ["- none"]),
		...(refused === "" ? [] : ["", refused]),
		...(unaccounted.length > 0 ? ["", ...unaccounted] : []),
		"",
		`Claims (${status.claims.length})`,
		...(claims.length > 0 ? claims : ["- none"]),
		...(alerts.length > 0 ? ["", ...alerts] : []),
		"",
		`You: ${sanitizeLine(status.me.label)} (${shortId(status.me.id)})${status.onBus ? "" : " \u00b7 not on the bus yet \u2014 `session join` puts you on it"}`,
	].join("\n");
}

/** How many unaccounted messages a listing names before it counts the rest. */
export const UNACCOUNTED_LINES = 6;

/** How much of a body the listing shows: enough to recognise the mail, not a transcript of it. */
export const UNACCOUNTED_PREVIEW = 60;

/**
 * The mail no record holds, as the lines both surfaces print: a headline naming the count and the
 * door, then one line per message — `- <id> · <sender> · <kind> · <age> · <first line>`.
 *
 * The id is the actionable field, so it is printed whole: `/sessions drop <id>` is the only door,
 * and an id clipped to its tail is one a person cannot type. The body is clipped, because this is a
 * status listing and not a read — `session inbox` never does the same, and cannot here either:
 * there is no record whose inbox this mail is.
 *
 * The headline's number is the page's, which counts files: a file this build cannot parse is kept
 * by the TTL and counts there, so a bus holding one reads as one more than the lines it names. It is
 * still the number a person acts on, because the file's own name holds the id a drop takes.
 */
export function unaccountedLines(page: UnaccountedPage, now: number): string[] {
	if (page.count === 0) return [];
	const lines = [
		`Unaccounted (${page.count}): mail for a record the bus no longer holds \u2014 \`/sessions drop <id>\` clears one`,
	];
	for (const { message, at } of page.messages.slice(0, UNACCOUNTED_LINES)) {
		const preview = clipText(sanitizeLine(message.text), UNACCOUNTED_PREVIEW);
		lines.push(
			`- ${sanitizeLine(message.id)}${SEPARATORS.item}${messageMeta(message)}${SEPARATORS.item}${ageText(now, at)}${SEPARATORS.item}${preview}`,
		);
	}
	const rest = page.count - Math.min(page.messages.length, UNACCOUNTED_LINES);
	if (rest > 0) lines.push(`- and ${rest} more`);
	return lines;
}

/**
 * The same listing as `/sessions drop`'s own answer, for a person who asked to see it.
 *
 * The command with no ids drops nothing, so it prints what a drop could name: one wording for what
 * the status shows and what the door shows, which is how the two cannot describe one bus apart.
 */
export function formatUnaccounted(page: UnaccountedPage | undefined, now: number): string {
	if (!page || page.count === 0) return "No unaccounted mail: every message on this bus has a record.";
	return unaccountedLines(page, now).join("\n");
}

/**
 * What a drop did: the mail that went, and the ids that stayed with the reason.
 *
 * One sentence per id, so an id that appears in both lists — a broadcast, whose live recipient
 * still has its copy — reads as both facts rather than one of them.
 */
export function formatDrop(result: DropResult): string {
	const lines = result.dropped.map((id) => `Dropped ${sanitizeLine(id)} \u2014 a message no record held.`);
	for (const kept of result.kept) {
		lines.push(
			kept.reason === "held"
				? `Not dropped: ${sanitizeLine(kept.id)} is held by ${sanitizeLine(kept.holder)} \u2014 read it with \`session inbox\` there.`
				: `Not dropped: ${sanitizeLine(kept.id)} is not waiting on this bus.`,
		);
	}
	return lines.length > 0 ? lines.join("\n") : "Nothing dropped.";
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

/**
 * The whole read is bounded at one message's maximum body: `inbox` is the surface the
 * prompt tells the model to run, so it is also the largest thing the bus can put in a
 * context. The cap is `lib/session-tool.ts`'s `MAX_MESSAGE_TEXT` — the same number `send`
 * refuses a body over, and a read never clips one — so a read costs at most one full-length
 * message: a burst of them is one message per call, where a page that clipped each body
 * would have shown a sliver of every one and deleted the rest.
 */
export const INBOX_BUDGET = MAX_MESSAGE_TEXT;

/** One inbox read: the text the model reads, and how many messages it covers. */
export interface ReadPage {
	text: string;
	shown: number;
}

/** One message as a numbered line, its body whole and its paths on a second line. */
function inboxLine(message: BusMessage, index: number): string {
	const paths = message.paths?.length
		? `\n   paths: ${message.paths.map((path) => sanitizeLine(path)).join(", ")}`
		: "";
	// The same grammar the transcript row and the notice use, so a reference reaches the model's
	// read as it reaches a screen — this line hand-built `from · kind` and dropped both.
	return `${index + 1}. ${messageMeta(message)}${SEPARATORS.item}${sanitizeLine(message.text)}${paths}`;
}

/**
 * The sentence for mail files this build could not read.
 *
 * Named rather than counted, because the name is what a person needs to look at the file, and
 * bounded to three so a directory full of them cannot fill the transcript. They are not gone:
 * the store leaves them on disk for a build that can read them, and the message TTL ends them.
 */
export function unreadableText(files: readonly string[]): string {
	if (files.length === 0) return "";
	const named = files.slice(0, 3).map(sanitizeLine).join(", ");
	const rest = files.length > 3 ? ` and ${files.length - 3} more` : "";
	return `Mail this build cannot read: ${named}${rest} — left on disk, cleared by the TTL.`;
}

/**
 * One inbox read, oldest first and bounded.
 *
 * Every body is rendered whole. A read displays and then consumes exactly what it showed,
 * so a clipped body would delete the rest of a message the model never read; the ceiling
 * therefore bounds how many whole messages one read takes, not how much of one it prints.
 * The first message is rendered whatever its size: a cap that showed nothing would leave a
 * caller holding unread mail it can neither see nor name.
 *
 * `shown` is what the caller may consume, and every message it counts reached the text in
 * full. The messages past that point are named rather than rendered, so the tail is true
 * because the mail behind it is left in the inbox for the next read.
 *
 * `waiting` is the mail outside this window for another reason — the caller's `limit`, or
 * mail the caller did not load — and it is counted into the same tail, because it is the
 * same instruction back. It is not clamped here: the caller counts the inbox, not the
 * window it happened to read, so a burst past the peek's own cap is named whole.
 */
export function formatInbox(
	messages: readonly BusMessage[],
	waiting = 0,
	unreadable: readonly string[] = [],
): ReadPage {
	const refused = unreadableText(unreadable);
	if (messages.length === 0) return { text: refused === "" ? "Inbox empty." : refused, shown: 0 };
	const lines: string[] = [];
	let used = 0;
	for (const message of messages) {
		const line = inboxLine(message, lines.length);
		if (lines.length > 0 && used + line.length > INBOX_BUDGET) break;
		lines.push(line);
		used += line.length + 1;
	}
	const shown = lines.length;
	// The unreadable files are not waiting to be read, so they are not part of what running
	// `inbox` again would return: counting them here is how a tail promises mail nobody can have.
	const more = Math.max(0, messages.length - shown + waiting - unreadable.length);
	if (more > 0) lines.push(`… ${more} more in the inbox — run \`inbox\` again.`);
	if (refused !== "") lines.push(refused);
	return { text: lines.join("\n"), shown };
}

/**
 * One read that consumes nothing: the bodies `inbox` would show, and the line that says so.
 *
 * The two calls differ in one fact, and the text has to carry it: a reader that took this for a
 * consume would stop calling, and the mail it left behind would never be removed.
 */
export function formatRead(messages: readonly BusMessage[], waiting = 0, unreadable: readonly string[] = []): string {
	const read = formatInbox(messages, waiting, unreadable);
	if (read.shown === 0) return read.text;
	return `${read.text}\nKept in the inbox — \`inbox\` consumes it.`;
}

/** Confirmation for a send. */
export function formatSend(delivered: readonly string[], messageId: string): string {
	if (delivered.length === 0) return "Delivered to 0 sessions.";
	const names = delivered.map((label) => sanitizeLine(label)).join(", ");
	return `Delivered to ${names} (${sanitizeLine(messageId)}).`;
}

/**
 * Claim result, including the owner that blocked it.
 *
 * The outcome comes before the paths, because a batch is all-or-nothing: a conflict means nothing was
 * claimed, and a list of holders under no such line reads as a partial success. A batch that carried
 * both says what it took and leaves the outcome to the line about it.
 */
export function formatClaim(claimed: readonly string[], conflicts: readonly ClaimConflict[]): string {
	const lines: string[] = [];
	if (claimed.length > 0) lines.push(`Claimed: ${claimed.map((path) => sanitizeLine(path)).join(", ")}.`);
	else if (conflicts.length > 0) lines.push("Nothing claimed.");
	for (const conflict of conflicts) {
		const owner = sanitizeLine(conflict.ownerLabel);
		lines.push(`${sanitizeLine(conflict.path)} is owned by ${owner} (${shortId(conflict.owner)}).`);
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
