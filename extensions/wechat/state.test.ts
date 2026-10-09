import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { emptyState, readState, recordInbound, writeState } from "./state.ts";

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
});
