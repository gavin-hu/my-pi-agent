/**
 * Reading and writing `<agentDir>/wechat/state.json`.
 *
 * Holds the long-poll cursor, the owner id, and per-peer reply tokens. It is
 * validated on read; a corrupt file degrades to empty state rather than losing
 * the connection permanently.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PeerState, SeenMessage, WechatState } from "./types.ts";
import { wechatDir } from "./credentials.ts";
import { peerKey } from "./format.ts";

/** How long a handled message id is remembered for a replay. */
export const SEEN_TTL_MS = 60 * 60 * 1000;
/** How many handled ids are kept across all peers. */
export const SEEN_MAX = 500;

/** The default state file path. */
export function statePath(): string {
	return join(wechatDir(), "state.json");
}

/** Fresh empty state. */
export function emptyState(): WechatState {
	return { cursor: "", peers: {} };
}

function normalizePeer(value: unknown): PeerState | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const peer: PeerState = {
		lastSeen: typeof raw.lastSeen === "number" && Number.isFinite(raw.lastSeen) ? raw.lastSeen : 0,
	};
	if (typeof raw.lastContextToken === "string" && raw.lastContextToken) peer.lastContextToken = raw.lastContextToken;
	return peer;
}

function normalizeSeen(value: unknown): SeenMessage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.peer !== "string" || raw.peer === "") return undefined;
	if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return undefined;
	if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return undefined;
	return { peer: raw.peer, id: raw.id, at: raw.at };
}

/** Read and validate the state file; a missing/corrupt file yields empty state. */
export function readState(path: string): WechatState {
	try {
		if (!existsSync(path)) return emptyState();
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
		const raw = parsed as Record<string, unknown>;
		const peers: Record<string, PeerState> = {};
		if (raw.peers && typeof raw.peers === "object" && !Array.isArray(raw.peers)) {
			for (const [id, value] of Object.entries(raw.peers as Record<string, unknown>)) {
				const peer = normalizePeer(value);
				if (peer) peers[id] = peer;
			}
		}
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
			peers,
			...(seen.length > 0 ? { seen: seen.slice(-SEEN_MAX) } : {}),
		};
	} catch {
		return emptyState();
	}
}

/** Write state to disk. */
export function writeState(path: string, state: WechatState): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/**
 * The key `peer` is stored under, accepting either id form.
 *
 * WeChat supplies the same person with and without the `@im.wechat` suffix
 * depending on the field: the stored owner id and `from_user_id` need not agree.
 * The first form seen wins, so a reply token recorded under one form is still
 * found by the other.
 */
function storedKey(state: WechatState, peer: string): string {
	const key = peerKey(peer);
	let best = peer;
	let bestSeen = Number.NEGATIVE_INFINITY;
	for (const [stored, entry] of Object.entries(state.peers)) {
		if (peerKey(stored) !== key) continue;
		// The freshest entry wins, so a duplicate left by an older version cannot
		// shadow the token that actually arrived last; the observed form is only a
		// tie-breaker, so a match is not moved for no reason.
		if (entry.lastSeen > bestSeen || (entry.lastSeen === bestSeen && stored === peer)) {
			best = stored;
			bestSeen = entry.lastSeen;
		}
	}
	return best;
}

/** The peer's entry, accepting either id form. */
export function findPeer(state: WechatState, peer: string): PeerState | undefined {
	return state.peers[storedKey(state, peer)];
}

/** Whether this message id was already handled for the peer. */
export function seenMessage(state: WechatState, peer: string, id: number): boolean {
	const key = peerKey(peer);
	return (state.seen ?? []).some((entry) => entry.peer === key && entry.id === id);
}

/** Remember a handled message id, pruning expired entries and capping the list. */
export function rememberMessage(state: WechatState, peer: string, id: number, now: number): void {
	const key = peerKey(peer);
	const cutoff = now - SEEN_TTL_MS;
	const seen = (state.seen ?? []).filter((entry) => entry.at >= cutoff);
	if (!seen.some((entry) => entry.peer === key && entry.id === id)) seen.push({ peer: key, id, at: now });
	state.seen = seen.slice(-SEEN_MAX);
}

/** Record an inbound message: store the reply token and the seen time. */
export function recordInbound(state: WechatState, peer: string, contextToken: string | undefined, now: number): void {
	const id = storedKey(state, peer);
	const existing = state.peers[id];
	state.peers[id] = {
		lastContextToken: contextToken ?? existing?.lastContextToken,
		lastSeen: now,
	};
}
