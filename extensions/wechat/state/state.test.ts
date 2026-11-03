/**
 * `state.json`: the round trip, the atomic write, and the per-peer helpers.
 *
 * Split out of the peer suite rather than grown there: this is one module's
 * behaviour, and the peer suite is a named height that may only fall.
 */

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../../test/helpers/env.ts";
import type { WechatState } from "../types.ts";
import {
	emptyState,
	findPeer,
	readState,
	recordInbound,
	rememberMessage,
	SEEN_MAX,
	SEEN_TTL_MS,
	seenMessage,
	writeState,
} from "./state.ts";

describe("state", () => {
	function newPath(): string {
		return join(tempDir("wechat-state-"), "state.json");
	}

	test("round-trips the cursor and peers", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", ownerId: "owner", peers: { p: { lastContextToken: "t", lastSeen: 7 } } });
		expect(readState(path)).toEqual({
			cursor: "c1",
			ownerId: "owner",
			peers: { p: { lastContextToken: "t", lastSeen: 7 } },
		});
	});

	test("returns empty state for a corrupt or missing file", () => {
		const broken = newPath();
		writeFileSync(broken, "{ broken", "utf-8");
		expect(readState(broken)).toEqual(emptyState());
		expect(readState(newPath())).toEqual(emptyState());
	});

	test("leaves no temp file behind when it replaces the state", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", peers: {} });
		writeState(path, { cursor: "c2", peers: {} });
		// The temp file was renamed over the state, so it is the state that is left.
		expect(readdirSync(dirname(path))).toEqual(["state.json"]);
		expect(readState(path).cursor).toBe("c2");
	});

	test("keeps the previous state when the new one cannot be written", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", peers: {}, seen: [{ peer: "alice", id: 1, at: 5 }] });
		// A state whose serializer throws stands in for a write that fails part-way: the
		// shape is never read, only serialized, so the cast hides nothing.
		const unserializable = {
			cursor: "c2",
			peers: {},
			toJSON() {
				throw new Error("cannot serialize");
			},
		} as unknown as WechatState;
		expect(() => writeState(path, unserializable)).toThrow("cannot serialize");
		expect(readState(path)).toEqual({ cursor: "c1", peers: {}, seen: [{ peer: "alice", id: 1, at: 5 }] });
		expect(readdirSync(dirname(path))).toEqual(["state.json"]);
	});

	test("recordInbound keeps the previous context token when a new one is absent", () => {
		const state = emptyState();
		recordInbound(state, "p", "tok", 1);
		recordInbound(state, "p", undefined, 2);
		expect(state.peers.p).toEqual({ lastContextToken: "tok", lastSeen: 2 });
	});

	test("recordInbound keeps one entry for either id form", () => {
		const state = emptyState();
		recordInbound(state, "alice@im.wechat", "tok", 1);
		recordInbound(state, "alice", "tok2", 2);
		// One person, one entry: the first form seen is the stored key.
		expect(Object.keys(state.peers)).toEqual(["alice@im.wechat"]);
		expect(findPeer(state, "alice")).toEqual({ lastContextToken: "tok2", lastSeen: 2 });
		expect(findPeer(state, "ALICE@im.wechat")).toEqual({ lastContextToken: "tok2", lastSeen: 2 });
		expect(findPeer(state, "nobody")).toBeUndefined();
	});

	test("remembers a message id by normalized peer and expires it", () => {
		const state = emptyState();
		rememberMessage(state, "alice@im.wechat", 7, 1000);
		expect(seenMessage(state, "alice", 7)).toBe(true);
		expect(seenMessage(state, "ALICE", 7)).toBe(true);
		expect(seenMessage(state, "alice", 8)).toBe(false);
		expect(seenMessage(state, "bob", 7)).toBe(false);

		// One hour later the entry is stale; remembering a newer id prunes it.
		rememberMessage(state, "alice", 9, 1000 + SEEN_TTL_MS + 1);
		expect(seenMessage(state, "alice", 7)).toBe(false);
		expect(seenMessage(state, "alice", 9)).toBe(true);
	});

	test("caps the remembered ids", () => {
		const state = emptyState();
		for (let id = 0; id < SEEN_MAX + 10; id++) rememberMessage(state, "alice", id, 1000);
		expect(state.seen).toHaveLength(SEEN_MAX);
		expect(seenMessage(state, "alice", 0)).toBe(false);
		expect(seenMessage(state, "alice", SEEN_MAX + 9)).toBe(true);
	});

	test("round-trips seen ids and drops malformed entries", () => {
		const path = newPath();
		writeState(path, {
			cursor: "",
			peers: {},
			seen: [{ peer: "alice", id: 1, at: 5 }, { peer: "", id: 2, at: 5 }, { peer: "bob", id: "x", at: 5 } as never],
		});
		expect(readState(path).seen).toEqual([{ peer: "alice", id: 1, at: 5 }]);
	});

	test("findPeer prefers the freshest duplicate left by an older version", () => {
		const state = emptyState();
		state.peers.alice = { lastContextToken: "stale", lastSeen: 1 };
		state.peers["alice@im.wechat"] = { lastContextToken: "fresh", lastSeen: 2 };
		expect(findPeer(state, "alice")?.lastContextToken).toBe("fresh");

		recordInbound(state, "alice", "newer", 3);
		expect(state.peers["alice@im.wechat"]?.lastContextToken).toBe("newer");
		expect(state.peers.alice?.lastContextToken).toBe("stale");
	});
});
