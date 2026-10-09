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

/** Record an inbound message: store the reply token and the seen time. */
export function recordInbound(state: WechatState, peer: string, contextToken: string | undefined, now: number): void {
	const existing = state.peers[peer];
	state.peers[peer] = {
		lastContextToken: contextToken ?? existing?.lastContextToken,
		lastSeen: now,
	};
}
