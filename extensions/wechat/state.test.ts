import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
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

function newPath(): string {
	return join(tempDir("wechat-state-"), "state.json");
}

describe("state", () => {
	test("round-trips the cursor and peers", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", ownerId: "owner", peers: { p: { lastContextToken: "t", lastSeen: 7 } } });
		expect(readState(path)).toEqual({
			cursor: "c1",
			ownerId: "owner",
			peers: { p: { lastContextToken: "t", lastSeen: 7 } },
		});
	});

	test("returns empty state for a corrupt file", () => {
		const path = newPath();
		writeFileSync(path, "{ broken", "utf-8");
		expect(readState(path)).toEqual(emptyState());
	});

	test("returns empty state when the file is missing", () => {
		expect(readState(newPath())).toEqual(emptyState());
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
	});

	test("findPeer returns undefined for an unknown peer", () => {
		expect(findPeer(emptyState(), "nobody")).toBeUndefined();
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
