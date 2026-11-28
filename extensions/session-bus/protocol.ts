/**
 * Pure protocol rules for the session bus.
 *
 * No filesystem or process access lives here: labels, targets, claim paths, and
 * validation are testable without a runtime. `store.ts` owns the files.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { EMPTY_PATH, outsideRepository, overLimit, sanitizeLine, tooManyPaths } from "../../lib/format.ts";
import { MAX_MESSAGE_TEXT, MESSAGE_KINDS, type MessageKind } from "../../lib/session-mail.ts";
import { SESSION_TOOL } from "../../lib/tool-names.ts";
import { memberOf } from "../../lib/json.ts";
import type { ClaimRecord } from "./types.ts";

/**
 * The label rules live in `lib/` because a label is shared vocabulary: the board
 * records one on a card it claims, and `session-bus` settles the one it is
 * addressed by. Re-exported here so every module in this extension keeps
 * importing its rules from the protocol they belong to.
 */
export { defaultLabel, MAX_LABEL, normalizeLabel, shortId } from "../../lib/session-label.ts";
import { labelKey } from "../../lib/session-label.ts";
import { type PeerRow, addressable, lookupPeer } from "../../lib/session-roster.ts";

export const TOOL_NAME = SESSION_TOOL;
export const COMMAND_NAME = "sessions";
/** The command's second destructive word, and the one spelling of the door every surface names. */
export const FORGET_WORD = "forget";

/** The command that frees a stopped session's name, for every sentence that points at it. */
export function forgetCommand(label: string): string {
	return `/${COMMAND_NAME} ${FORGET_WORD} ${sanitizeLine(label)}`;
}
/**
 * The caps and the default this protocol settles for itself — the text cap is not one: it is the
 * envelope's own `MAX_MESSAGE_TEXT`, in `lib/session-mail.ts`.
 *
 * `MAX_PATHS` is exported because the tool's schema publishes it: the host refuses a longer list
 * before `execute`, while the request path a command takes still reads it here. `MIN_PATHS` is the
 * same read for the other end: `normalizePaths` refuses an empty list, and the schema states it.
 */
export const MIN_PATHS = 1;
export const MAX_PATHS = 20;
const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

import type { SessionMode } from "../../lib/session-files.ts";

/**
 * The mode a record says its session was started in. `lib/session-files.ts` owns the word, because
 * the record's shape and the guard that accepts it live together there; re-exported so this
 * extension keeps importing its protocol's vocabulary from its protocol.
 */
export type { SessionMode };
type SessionAction = "status" | "send" | "inbox" | "read" | "claim" | "release" | "join";
/**
 * The mail's kinds, and the field they are written in, are `lib/session-mail.ts`'s — the one
 * reader and writer of a message file. Re-exported so this extension keeps importing its
 * protocol's vocabulary from its protocol.
 */
export type { MessageKind } from "../../lib/session-mail.ts";

const ACTIONS: readonly SessionAction[] = ["status", "send", "inbox", "read", "claim", "release", "join"];

/** The session mode as the record stores it. */
export function sessionMode(mode: string | undefined): SessionMode {
	return mode === "tui" || mode === "rpc" || mode === "json" || mode === "print" ? mode : "unknown";
}

/** An action, or undefined when the model sent an unknown one. */
export function normalizeAction(raw: unknown): SessionAction | undefined {
	return memberOf(ACTIONS, raw);
}

/**
 * The fields each action reads.
 *
 * The parameters are one flat object, so every field is published to every action at once and
 * only this table stops one reaching an action that would drop it. It lives here, beside the action
 * list and its normalizer, so a new verb adds its row where it is declared. `lib/stray-fields.ts`
 * words the refusal; `stray-field.test.ts` holds the other direction, so a published field cannot
 * go unclaimed.
 *
 * `undefined` is not a stray — a field the caller left out was never passed — so a codemode
 * caller's `key: undefined` is not refused for a field it never sent.
 */
export const ACTION_FIELDS: Record<SessionAction, readonly string[]> = {
	status: [],
	send: ["to", "text", "kind", "key", "replyTo", "about", "paths"],
	inbox: ["limit"],
	read: ["limit"],
	claim: ["paths"],
	release: ["paths", "holder"],
	join: ["label", "wake", "listen"],
};

/** A message kind; `message` is the default, which is this protocol's fact rather than a lookup's. */
export function normalizeKind(raw: unknown): MessageKind {
	return memberOf(MESSAGE_KINDS, raw) ?? "message";
}

/** Trimmed message text, or an error message. */
export function normalizeText(raw: unknown): { text: string } | { error: string } {
	if (typeof raw !== "string" || raw.trim() === "") return { error: "text is required." };
	const text = raw.trim();
	if (text.length > MAX_MESSAGE_TEXT) return { error: overLimit("text", text.length, MAX_MESSAGE_TEXT) };
	return { text };
}

/** The longest a reference may be, and the longest key a sender may name a message with. */
export const MAX_REFERENCE = 64;

/**
 * What a one-word reference may hold, so it is a word a person can retype.
 *
 * Exported because the tool's schema publishes it: the host refuses a bad `key` or `replyTo`
 * before the call runs, while the guards below stay the boundary for the request path a command
 * takes. One pattern with two readers, so the published rule cannot say something else.
 */
export const REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** The pattern above, as a refusal says it. */
const REFERENCE_ALPHABET = 'letters, digits, ".", "_", "-" and ":"';

/** A sender's name for one message, or an error; absent when it gave none. */
export function normalizeKey(raw: unknown): { key?: string } | { error: string } {
	if (typeof raw !== "string" || raw.trim() === "") return {};
	const key = raw.trim();
	if (key.length > MAX_REFERENCE) return { error: overLimit("key", key.length, MAX_REFERENCE) };
	if (!REFERENCE_PATTERN.test(key)) return { error: `key "${sanitizeLine(key)}" may hold ${REFERENCE_ALPHABET}.` };
	return { key };
}

/** An id one message answers, or an error; absent when the sender answered nothing. */
export function normalizeReplyTo(raw: unknown): { value?: string } | { error: string } {
	if (raw === undefined) return {};
	if (typeof raw !== "string" || raw.trim() === "") return { error: "replyTo must be a non-empty string." };
	const value = raw.trim();
	if (value.length > MAX_REFERENCE) return { error: overLimit("replyTo", value.length, MAX_REFERENCE) };
	if (!REFERENCE_PATTERN.test(value)) {
		return { error: `replyTo "${sanitizeLine(value)}" may hold ${REFERENCE_ALPHABET}.` };
	}
	return { value };
}

/**
 * What a message is about, or an error; absent when the sender said nothing.
 *
 * Deliberately not on {@link REFERENCE_PATTERN}: `about` names something another domain built — a
 * card is `#673` on the board, which is the spelling `cardRef` prints and `normalizeCardId` reads
 * back — so the bus carries the sender's own spelling rather than a vocabulary of its own. What
 * one line of it may be is all this settles: sanitized (control characters out, newlines closed
 * up, spaces collapsed) and bounded, because it is stored on a message and drawn on a row.
 */
export function normalizeAbout(raw: unknown): { value?: string } | { error: string } {
	if (raw === undefined) return {};
	const value = typeof raw === "string" ? sanitizeLine(raw) : "";
	if (value === "") return { error: "about must be a non-empty string." };
	if (value.length > MAX_REFERENCE) return { error: overLimit("about", value.length, MAX_REFERENCE) };
	return { value };
}

/** A send's words once they are settled: what the envelope will carry, in the order it says them. */
export interface SendFields {
	text: string;
	kind: MessageKind;
	key?: string;
	replyTo?: string;
	about?: string;
}

/**
 * Settle a send's own words — its body, kind, and the three references — or say why not.
 *
 * One body, because these five are one envelope and their refusals are one answer: a caller that
 * settled them apart would have to keep the order and the sentences, and `runtime.send` would be
 * the second copy. Only what the bus cannot check — who the recipients are — stays outside.
 */
export function settleSend(input: {
	to: string;
	text: string;
	kind?: unknown;
	key?: unknown;
	replyTo?: unknown;
	about?: unknown;
}): { fields: SendFields } | { error: string } {
	const text = normalizeText(input.text);
	if ("error" in text) return { error: text.error };
	const keyed = normalizeKey(input.key);
	if ("error" in keyed) return { error: keyed.error };
	const replyTo = normalizeReplyTo(input.replyTo);
	if ("error" in replyTo) return { error: replyTo.error };
	const about = normalizeAbout(input.about);
	if ("error" in about) return { error: about.error };
	const kind = normalizeKind(input.kind);
	if (input.to.trim() === "*" && kind !== "event") return { error: 'a broadcast needs kind: "event".' };
	return {
		fields: {
			text: text.text,
			kind,
			...(keyed.key === undefined ? {} : { key: keyed.key }),
			...(replyTo.value === undefined ? {} : { replyTo: replyTo.value }),
			...(about.value === undefined ? {} : { about: about.value }),
		},
	};
}

/** The most paths a lapse notice names before it counts the rest. */
const NOTICE_PATHS = 6;

/**
 * The claims a lapse notice is owed for, grouped by owner.
 *
 * Two of the three skips are the bus's reach rather than a preference: a claim another machine wrote
 * is judged by that machine's heartbeat, and mail reaches only the sessions here, so that owner is
 * not told by this bus. The third is this session's own row — a session is its own recipient, and
 * its housekeeping is not news to it.
 */
export function lapsedOwners(
	claims: readonly ClaimRecord[],
	view: { host?: string; self: string },
): Map<string, ClaimRecord[]> {
	const owners = new Map<string, ClaimRecord[]>();
	for (const claim of claims) {
		if (claim.owner === view.self) continue;
		if (claim.host !== undefined && claim.host !== view.host) continue;
		const held = owners.get(claim.owner);
		if (held === undefined) owners.set(claim.owner, [claim]);
		else held.push(claim);
	}
	return owners;
}

/**
 * What one lapsed owner is told: the paths it no longer holds, and the one thing to do about them.
 *
 * The paths are named back because they are the whole of what it lost — a returning session knows
 * its work, not which of its files a peer may now take — and at most six of them, so the notice
 * stays a sentence. Their spelling is the store's, which is already sanitized, and this line is
 * the last place a filename could carry a newline into a message body.
 */
export function lapseNotice(paths: readonly string[]): string {
	const named = paths.slice(0, NOTICE_PATHS).join(", ");
	const rest = paths.length - NOTICE_PATHS;
	const counted = paths.length === 1 ? "1 path is" : `${paths.length} paths are`;
	const again = paths.length === 1 ? "it" : "them";
	const more = rest > 0 ? ` and ${rest} more` : "";
	return sanitizeLine(
		`claim lapse: ${counted} no longer yours — ${named}${more}. Claim ${again} again if the work is still yours.`,
	);
}

/** A shared inbox limit. */
export function normalizeLimit(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

/**
 * Repository-relative, posix-normalized paths, or an error.
 *
 * A path that resolves to the repository root is handed on in the caller's own spelling
 * rather than refused here: what it resolves to is the whole repository, and that
 * refusal, with the sentence it is worded in, belongs to `resolve.ts` — one rule, one
 * wording, and one module that owns both.
 */
export function normalizePaths(repoRoot: string, cwd: string, raw: unknown): { paths: string[] } | { error: string } {
	if (!Array.isArray(raw) || raw.length < MIN_PATHS) return { error: "paths must contain at least one path." };
	if (raw.length > MAX_PATHS) return { error: tooManyPaths(MAX_PATHS) };
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || entry.trim() === "") return { error: EMPTY_PATH };
		const given = entry.trim();
		const absolute = resolve(cwd, given);
		const rel = relative(repoRoot, absolute);
		if (rel === "") {
			if (!paths.includes(given)) paths.push(given);
			continue;
		}
		if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			return { error: outsideRepository(entry) };
		}
		const normalized = rel.split(sep).join("/");
		if (!paths.includes(normalized)) paths.push(normalized);
	}
	return { paths };
}

/**
 * Resolve `to` to active sessions; `*` is broadcast and excludes the sender.
 *
 * Which record a name reaches is `lib/session-roster.ts`'s rule; this function only words its
 * answers, and refuses a stopped record rather than confirming mail nobody will read.
 */
export function resolveRecipients(
	rows: readonly PeerRow[],
	to: string,
	from: string,
): { recipients: PeerRow[] } | { error: string } {
	const target = to.trim();
	if (target === "") return { error: "to is required." };
	if (target === "*") {
		const recipients = addressable(rows, from).filter((row) => row.id !== from);
		return recipients.length === 0 ? { error: "there are no other active sessions." } : { recipients };
	}
	const found = lookupPeer(rows, { id: target, label: target }, from);
	if (found.ambiguous !== undefined) return { error: `the label "${target}" is ambiguous; use a session id.` };
	// A name no live record holds and a name only a stopped record holds are different facts: one is a
	// typo to retype, the other a name to drop. Only a **label** reaches this branch — `lookupPeer`'s
	// last step answers a stopped record by its id, so an id spelling arrives with a peer below — and
	// `lookupPeer` answers nothing for a label, because a label is a role a later session may take. So
	// the label's stopped holder is read here, where nothing but the sentence depends on it.
	const stopped = (peer: PeerRow | undefined): boolean => peer !== undefined && peer.state === "gone";
	if (found.peer === undefined) {
		const key = labelKey(target);
		return {
			error: rows.some((row) => row.state === "gone" && labelKey(row.label) === key)
				? `no active session "${target}" — its process is gone.`
				: `no active session "${target}".`,
		};
	}
	// The sender is its own recipient whatever its record says, which is what a note to itself is.
	if (stopped(found.peer) && found.peer.id !== from) {
		return { error: `no active session "${target}" — its process is gone.` };
	}
	return { recipients: [found.peer] };
}
