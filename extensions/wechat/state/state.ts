/**
 * Reading and writing `<agent-dir>/wechat/state.json`.
 *
 * Holds the long-poll cursor, the owner id, the conversation's reply token, and
 * the recently handled message ids. It is validated on read; a corrupt file
 * degrades to empty state rather than losing the connection permanently.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFile } from "../../../lib/json.ts";
import type { BotCredentials, OwnerRecord, SeenMessage, WechatState } from "../types.ts";
import type { MessageTarget } from "../transport/deliver.ts";
import { wechatDir } from "./credentials.ts";

/** How long a handled message id is remembered for a replay. */
export const SEEN_TTL_MS = 60 * 60 * 1000;
/** How many handled ids are kept. */
export const SEEN_MAX = 500;

/** The default state file path. */
export function statePath(): string {
	return join(wechatDir(), "state.json");
}

/** Fresh empty state. */
export function emptyState(): WechatState {
	return { cursor: "" };
}

function normalizeOwner(value: unknown): OwnerRecord | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const owner: OwnerRecord = {
		lastSeen: typeof raw.lastSeen === "number" && Number.isFinite(raw.lastSeen) ? raw.lastSeen : 0,
	};
	if (typeof raw.lastContextToken === "string" && raw.lastContextToken) owner.lastContextToken = raw.lastContextToken;
	return owner;
}

function normalizeSeen(value: unknown): SeenMessage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return undefined;
	if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return undefined;
	return { id: raw.id, at: raw.at };
}

/** Read and validate the state file; a missing/corrupt file yields empty state. */
export function readState(path: string): WechatState {
	try {
		if (!existsSync(path)) return emptyState();
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
		const raw = parsed as Record<string, unknown>;
		const owner = normalizeOwner(raw.owner);
		const seen: SeenMessage[] = [];
		if (Array.isArray(raw.seen)) {
			for (const value of raw.seen) {
				const entry = normalizeSeen(value);
				if (entry) seen.push(entry);
			}
		}
		return {
			cursor: typeof raw.cursor === "string" ? raw.cursor : "",
			ownerId: typeof raw.ownerId === "string" && raw.ownerId ? raw.ownerId : undefined,
			...(owner ? { owner } : {}),
			...(seen.length > 0 ? { seen: seen.slice(-SEEN_MAX) } : {}),
		};
	} catch {
		return emptyState();
	}
}

/**
 * Write state to disk by the one atomic JSON write, mode `0600`.
 *
 * A torn write would leave a file `readState` cannot parse, and its fallback is empty
 * state — the cursor and the remembered ids would go with it, so the server would
 * replay and already-answered messages would be answered again. The mode is the other
 * half: the file carries the conversation's reply token, so it is as private as the
 * credentials beside it.
 */
export function writeState(path: string, state: WechatState): void {
	writeJsonFile(path, state, { mode: 0o600 });
}

/** The conversation's record: the reply token and the last inbound time. */
export function ownerRecord(state: WechatState): OwnerRecord | undefined {
	return state.owner;
}

/**
 * Who a proactive send goes to, and the token that carries it.
 *
 * Either id form may be stored: the owner id comes from the login response and the
 * token from an inbound `from_user_id`, and they need not agree.
 */
export function ownerTarget(state: WechatState, account: BotCredentials): MessageTarget {
	const peer = state.ownerId ?? account.ilinkUserId;
	return { peer, contextToken: state.owner?.lastContextToken };
}

/** Whether this message id was already handled. */
export function seenMessage(state: WechatState, id: number): boolean {
	return (state.seen ?? []).some((entry) => entry.id === id);
}

/** Remember a handled message id, pruning expired entries and capping the list. */
export function rememberMessage(state: WechatState, id: number, now: number): void {
	const cutoff = now - SEEN_TTL_MS;
	const seen = (state.seen ?? []).filter((entry) => entry.at >= cutoff);
	if (!seen.some((entry) => entry.id === id)) seen.push({ id, at: now });
	state.seen = seen.slice(-SEEN_MAX);
}

/** Record an inbound message: store the reply token and the seen time. */
export function recordInbound(state: WechatState, contextToken: string | undefined, now: number): void {
	state.owner = {
		lastContextToken: contextToken ?? state.owner?.lastContextToken,
		lastSeen: now,
	};
}
