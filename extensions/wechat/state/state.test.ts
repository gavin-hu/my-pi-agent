/**
 * `state.json`: the round trip, the atomic write, and the one conversation's helpers.
 *
 * Split out of the worker suite rather than grown there: this is one module's
 * behaviour, and the worker suite is a named height that may only fall.
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { modeOfOwnerOnlyWrite, tempDir } from "../../../test/helpers/env.ts";
import type { WechatState } from "../types.ts";
import {
	emptyState,
	ownerRecord,
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

	test("round-trips the cursor, the owner, and its record", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", ownerId: "owner", owner: { lastContextToken: "t", lastSeen: 7 } });
		expect(readState(path)).toEqual({
			cursor: "c1",
			ownerId: "owner",
			owner: { lastContextToken: "t", lastSeen: 7 },
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
		writeState(path, { cursor: "c1" });
		writeState(path, { cursor: "c2" });
		// The temp file was renamed over the state, so it is the state that is left.
		expect(readdirSync(dirname(path))).toEqual(["state.json"]);
		expect(readState(path).cursor).toBe("c2");
	});

	test("keeps the previous state when the new one cannot be written", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", seen: [{ id: 1, at: 5 }] });
		// A state whose serializer throws stands in for a write that fails part-way: the
		// shape is never read, only serialized, so the cast hides nothing.
		const unserializable = {
			cursor: "c2",
			toJSON() {
				throw new Error("cannot serialize");
			},
		} as unknown as WechatState;
		expect(() => writeState(path, unserializable)).toThrow("cannot serialize");
		expect(readState(path)).toEqual({ cursor: "c1", seen: [{ id: 1, at: 5 }] });
		expect(readdirSync(dirname(path))).toEqual(["state.json"]);
	});

	test("recordInbound keeps the previous context token when a new one is absent", () => {
		const state = emptyState();
		recordInbound(state, "tok", 1);
		recordInbound(state, undefined, 2);
		expect(ownerRecord(state)).toEqual({ lastContextToken: "tok", lastSeen: 2 });
	});

	test("remembers a message id and expires it", () => {
		const state = emptyState();
		rememberMessage(state, 7, 1000);
		expect(seenMessage(state, 7)).toBe(true);
		expect(seenMessage(state, 8)).toBe(false);

		// One hour later the entry is stale; remembering a newer id prunes it.
		rememberMessage(state, 9, 1000 + SEEN_TTL_MS + 1);
		expect(seenMessage(state, 7)).toBe(false);
		expect(seenMessage(state, 9)).toBe(true);
	});

	test("caps the remembered ids", () => {
		const state = emptyState();
		for (let id = 0; id < SEEN_MAX + 10; id++) rememberMessage(state, id, 1000);
		expect(state.seen).toHaveLength(SEEN_MAX);
		expect(seenMessage(state, 0)).toBe(false);
		expect(seenMessage(state, SEEN_MAX + 9)).toBe(true);
	});

	test("round-trips seen ids and drops malformed entries", () => {
		const path = newPath();
		writeState(path, {
			cursor: "",
			seen: [{ id: 1, at: 5 }, { id: "x", at: 5 } as never, { id: 2 } as never],
		});
		expect(readState(path).seen).toEqual([{ id: 1, at: 5 }]);
	});

	test.skipIf(process.platform === "win32")("writes the state file owner-only", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", owner: { lastContextToken: "token", lastSeen: 1 } });
		const mode = statSync(path).mode & 0o777;
		// The claim is "what an owner-only write gives on this machine", so the control is
		// the machine's own answer: a write that named no mode still parts from it.
		const ownerOnly = modeOfOwnerOnlyWrite();
		expect(
			mode,
			`umask 0${process.umask().toString(8)}, probe 0${ownerOnly.toString(8)}, file 0${mode.toString(8)}`,
		).toBe(ownerOnly);
	});
});
