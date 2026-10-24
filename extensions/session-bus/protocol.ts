/**
 * Pure protocol rules for the session bus.
 *
 * No filesystem or process access lives here: labels, targets, claim paths, and
 * validation are testable without a runtime. `store.ts` owns the files.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { sanitizeLine } from "../../lib/format.ts";

export const TOOL_NAME = "session";
export const COMMAND_NAME = "sessions";
export const MAX_TEXT = 4_000;
export const MAX_PATHS = 20;
export const MAX_LABEL = 40;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export type SessionMode = "tui" | "rpc" | "json" | "print" | "unknown";
export type SessionAction = "status" | "send" | "inbox" | "claim" | "release" | "join" | "leave" | "watch";
export type MessageKind = "message" | "event" | "ask" | "handoff";

const ACTIONS: readonly SessionAction[] = ["status", "send", "inbox", "claim", "release", "join", "leave", "watch"];
const KINDS: readonly MessageKind[] = ["message", "event", "ask", "handoff"];

/** Only a terminal session is visible on the bus before it asks to join. */
export function isAutoJoinMode(mode: string | undefined): boolean {
	return mode === "tui";
}

/** The session mode as the record stores it. */
export function sessionMode(mode: string | undefined): SessionMode {
	return mode === "tui" || mode === "rpc" || mode === "json" || mode === "print" ? mode : "unknown";
}

/** A safe label, used both for display and as a target. */
export function normalizeLabel(raw: string | undefined, fallback: string): string {
	const text = sanitizeLine(raw ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return (text || fallback).slice(0, MAX_LABEL);
}

/** A short, display-only suffix for a session id. */
export function shortId(id: string): string {
	const clean = id.replace(/[^a-zA-Z0-9]/g, "");
	return (clean || id).slice(-6);
}

/** The automatic label before uniqueness is applied. */
export function defaultLabel(sessionName: string | undefined, cwd: string, id: string): string {
	const base = normalizeLabel(sessionName, normalizeLabel(cwd.split(/[\\/]/).filter(Boolean).at(-1), "session"));
	return normalizeLabel(base, `session-${shortId(id)}`);
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

/** Repository-relative, posix-normalized paths, or an error. */
export function normalizePaths(repoRoot: string, cwd: string, raw: unknown): { paths: string[] } | { error: string } {
	if (!Array.isArray(raw) || raw.length === 0) return { error: "paths must contain at least one path." };
	if (raw.length > MAX_PATHS) return { error: `at most ${MAX_PATHS} paths are allowed.` };
	const paths: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || entry.trim() === "") return { error: "every path must be a non-empty string." };
		const absolute = resolve(cwd, entry.trim());
		const rel = relative(repoRoot, absolute);
		if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
			return { error: `path "${entry}" is outside the repository.` };
		}
		const normalized = rel.split(sep).join("/");
		if (!paths.includes(normalized)) paths.push(normalized);
	}
	return { paths };
}

/**
 * Whether one claim covers the other path in either direction.
 *
 * The predicate is `lib/claims/overlap.ts`, because plan approval validates a
 * split with the same question; a second copy here is how the two answers drift.
 */
export { claimsConflict } from "../../lib/claims/overlap.ts";

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
