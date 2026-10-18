/**
 * Reading and writing `<agentDir>/wechat/state.json`.
 *
 * Holds the long-poll cursor, the owner id, and per-peer reply tokens. It is
 * validated on read; a corrupt file degrades to empty state rather than losing
 * the connection permanently.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PeerState, WechatState } from "./types.ts";
import { wechatDir } from "./credentials.ts";
import { peerKey } from "./format.ts";

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
		return {
			cursor: typeof raw.cursor === "string" ? raw.cursor : "",
			ownerId: typeof raw.ownerId === "string" && raw.ownerId ? raw.ownerId : undefined,
			peers,
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

/** Record an inbound message: store the reply token and the seen time. */
export function recordInbound(state: WechatState, peer: string, contextToken: string | undefined, now: number): void {
	const id = storedKey(state, peer);
	const existing = state.peers[id];
	state.peers[id] = {
		lastContextToken: contextToken ?? existing?.lastContextToken,
		lastSeen: now,
	};
}
