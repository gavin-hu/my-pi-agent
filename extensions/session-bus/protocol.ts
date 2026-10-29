/**
 * Pure protocol rules for the session bus.
 *
 * No filesystem or process access lives here: labels, targets, claim paths, and
 * validation are testable without a runtime. `store.ts` owns the files.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";
import { SESSION_TOOL } from "../../lib/tool-names.ts";

/**
 * The label rules live in `lib/` because a label is shared vocabulary: the board
 * records one on a card it claims, and `session-bus` settles the one it is
 * addressed by. Re-exported here so every module in this extension keeps
 * importing its rules from the protocol they belong to.
 */
export { defaultLabel, MAX_LABEL, normalizeLabel, shortId } from "../../lib/session-label.ts";

export const TOOL_NAME = SESSION_TOOL;
export const COMMAND_NAME = "sessions";
/**
 * The text cap, from `lib/session-tool.ts`, where the callers that clip to it live.
 * Re-exported the way the label rules are, so this extension imports its protocol's
 * constants from one place and two extensions cannot drift apart on the number.
 */
export const MAX_TEXT = MAX_MESSAGE_TEXT;
export const MAX_PATHS = 20;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type SessionMode = "tui" | "rpc" | "json" | "print" | "unknown";
export type SessionAction = "status" | "send" | "inbox" | "claim" | "release" | "join";
export type MessageKind = "message" | "event" | "ask" | "handoff";

const ACTIONS: readonly SessionAction[] = ["status", "send", "inbox", "claim", "release", "join"];
const KINDS: readonly MessageKind[] = ["message", "event", "ask", "handoff"];

/** The session mode as the record stores it. */
export function sessionMode(mode: string | undefined): SessionMode {
	return mode === "tui" || mode === "rpc" || mode === "json" || mode === "print" ? mode : "unknown";
}

/** An action, or undefined when the model sent an unknown one. */
export function normalizeAction(raw: unknown): SessionAction | undefined {
	return typeof raw === "string" && ACTIONS.includes(raw as SessionAction) ? (raw as SessionAction) : undefined;
}

/** A message kind; `message` is the default. */
export function normalizeKind(raw: unknown): MessageKind {
	return typeof raw === "string" && KINDS.includes(raw as MessageKind) ? (raw as MessageKind) : "message";
}

/** Trimmed message text, or an error message. */
export function normalizeText(raw: unknown): { text: string } | { error: string } {
	if (typeof raw !== "string" || raw.trim() === "") return { error: "text is required." };
	const text = raw.trim();
	if (text.length > MAX_TEXT) return { error: `text must be at most ${MAX_TEXT} characters.` };
	return { text };
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
	if (raw.length > MAX_PATHS) return { error: `at most ${MAX_PATHS} paths are allowed.` };
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || entry.trim() === "") return { error: "every path must be a non-empty string." };
		const given = entry.trim();
		const absolute = resolve(cwd, given);
		const rel = relative(repoRoot, absolute);
		if (rel === "") {
			if (!paths.includes(given)) paths.push(given);
			continue;
		}
		if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			return { error: `path "${entry}" is outside the repository.` };
		}
		const normalized = rel.split(sep).join("/");
		if (!paths.includes(normalized)) paths.push(normalized);
	}
	return { paths };
}

/** Resolve `to` to active sessions; `*` is broadcast and excludes the sender. */
export function resolveRecipients(
	sessions: readonly { id: string; label: string }[],
	to: string,
	from: string,
): { recipients: Array<{ id: string; label: string }> } | { error: string } {
	const target = to.trim();
	if (target === "") return { error: "to is required." };
	if (target === "*") {
		const recipients = sessions.filter((session) => session.id !== from);
		return recipients.length === 0 ? { error: "there are no other active sessions." } : { recipients };
	}
	const exact = sessions.find((session) => session.id === target);
	if (exact) return { recipients: [exact] };
	const byLabel = sessions.filter((session) => session.label.toLowerCase() === target.toLowerCase());
	if (byLabel.length === 1) return { recipients: byLabel };
	if (byLabel.length > 1) return { error: `the label "${target}" is ambiguous; use a session id.` };
	return { error: `no active session "${target}".` };
}
