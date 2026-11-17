/**
 * Pure protocol rules for the session bus.
 *
 * No filesystem or process access lives here: labels, targets, claim paths, and
 * validation are testable without a runtime. `store.ts` owns the files.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { EMPTY_PATH, outsideRepository, tooManyPaths } from "../../lib/format.ts";
import { MESSAGE_KINDS, type MessageKind } from "../../lib/session-mail.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";
import { SESSION_TOOL } from "../../lib/tool-names.ts";
import { memberOf } from "../../lib/json.ts";

/**
 * The label rules live in `lib/` because a label is shared vocabulary: the board
 * records one on a card it claims, and `session-bus` settles the one it is
 * addressed by. Re-exported here so every module in this extension keeps
 * importing its rules from the protocol they belong to.
 */
export { defaultLabel, MAX_LABEL, normalizeLabel, shortId } from "../../lib/session-label.ts";
import { type PeerRow, addressable, lookupPeer } from "../../lib/session-roster.ts";

export const TOOL_NAME = SESSION_TOOL;
export const COMMAND_NAME = "sessions";
/**
 * The caps and the default this protocol settles for itself. The text cap is not one: it is
 * `lib/session-tool.ts`'s `MAX_MESSAGE_TEXT`, because the callers that clip to it live there.
 */
const MAX_PATHS = 20;
const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type SessionMode = "tui" | "rpc" | "json" | "print" | "unknown";
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

/** A message kind; `message` is the default, which is this protocol's fact rather than a lookup's. */
export function normalizeKind(raw: unknown): MessageKind {
	return memberOf(MESSAGE_KINDS, raw) ?? "message";
}

/** Trimmed message text, or an error message. */
export function normalizeText(raw: unknown): { text: string } | { error: string } {
	if (typeof raw !== "string" || raw.trim() === "") return { error: "text is required." };
	const text = raw.trim();
	if (text.length > MAX_MESSAGE_TEXT) return { error: `text must be at most ${MAX_MESSAGE_TEXT} characters.` };
	return { text };
}

/** The longest key a sender may name a message with. */
const MAX_KEY = 64;

/** What a key may hold, so it is one word a person can retype. */
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** A sender's name for one message, or an error; absent when it gave none. */
export function normalizeKey(raw: unknown): { key?: string } | { error: string } {
	if (typeof raw !== "string" || raw.trim() === "") return {};
	const key = raw.trim();
	if (key.length > MAX_KEY) return { error: `key must be at most ${MAX_KEY} characters.` };
	if (!KEY_PATTERN.test(key)) return { error: 'key may hold letters, digits, ".", "_", "-" and ":".' };
	return { key };
}

/** The two references a message may carry, and the field each is written in. */
export type MessageReference = "replyTo" | "about";

/**
 * A reference a message carries — an id that answers one, or the thing it is about — or an error.
 *
 * One word in the same alphabet as `key`, because these are ids other sessions built and a reader
 * retypes them: a value with whitespace in it would be a sentence the bus pretends is an id.
 */
export function normalizeReference(field: MessageReference, raw: unknown): { value?: string } | { error: string } {
	if (raw === undefined) return {};
	if (typeof raw !== "string" || raw.trim() === "") return { error: `${field} must be a non-empty string.` };
	const value = raw.trim();
	if (value.length > MAX_KEY) return { error: `${field} must be at most ${MAX_KEY} characters.` };
	if (!KEY_PATTERN.test(value)) return { error: `${field} may hold letters, digits, ".", "_", "-" and ":".` };
	return { value };
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
	if (!Array.isArray(raw) || raw.length === 0) return { error: "paths must contain at least one path." };
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
	// The sender is its own recipient whatever its record says, which is what a note to itself is.
	if (found.peer === undefined || (found.peer.state === "gone" && found.peer.id !== from)) {
		return { error: `no active session "${target}".` };
	}
	return { recipients: [found.peer] };
}
