import { describe, expect, test } from "bun:test";
import {
	buildRewindPoints,
	lastUserEntryId,
	messageText,
	rewindScopes,
	userMessagesFromBranch,
	type RewindPoint,
} from "../../extensions/rewind/timeline.ts";
import type { Snapshot } from "../../extensions/rewind/types.ts";

function userEntry(id: string, content: unknown, timestamp = 1000): any {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		message: { role: "user", content, timestamp },
	};
}

function assistantEntry(id: string): any {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(1000).toISOString(),
		message: { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 1000 },
	};
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		id: "s1",
		ref: "refs/pi/rewind/s1",
		commit: "deadbeef",
		reason: "auto",
		timestamp: 1000,
		root: "/repo",
		head: "deadbeef",
		clean: false,
		includeUntracked: true,
		sessionId: "sess",
		entryId: "e1",
		...overrides,
	};
}

describe("messageText", () => {
	test("handles strings and text blocks, ignoring images", () => {
		expect(messageText("hello")).toBe("hello");
		expect(
			messageText([
				{ type: "text", text: "one" },
				{ type: "image", data: "x", mimeType: "image/png" },
				{ type: "text", text: "two" },
			]),
		).toBe("one\ntwo");
		expect(messageText([{ type: "image", data: "x", mimeType: "image/png" }])).toBe("");
	});
});

describe("lastUserEntryId", () => {
	test("returns the last user message entry", () => {
		const branch = [userEntry("e1", "first"), assistantEntry("a1"), userEntry("e2", "second")];
		expect(lastUserEntryId(branch)).toBe("e2");
	});

	test("returns null without a user message", () => {
		expect(lastUserEntryId([assistantEntry("a1")])).toBeNull();
	});
});

describe("userMessagesFromBranch", () => {
	test("extracts only user messages in branch order", () => {
		const branch = [userEntry("e1", "first", 1000), assistantEntry("a1"), userEntry("e2", "second", 2000)];
		expect(userMessagesFromBranch(branch)).toEqual([
			{ entryId: "e1", text: "first", timestamp: 1000 },
			{ entryId: "e2", text: "second", timestamp: 2000 },
		]);
	});
});

describe("buildRewindPoints", () => {
	const branch = [userEntry("e1", "first", 1000), assistantEntry("a1"), userEntry("e2", "second", 2000)];

	test("matches an auto snapshot by entry and session, newest first", () => {
		const points = buildRewindPoints(branch, [snapshot({ id: "s1", entryId: "e1" })], "sess");
		expect(points.map((point) => point.entryId)).toEqual(["e2", "e1"]);
		expect(points[1].snapshot?.id).toBe("s1");
		expect(points[0].snapshot).toBeUndefined();
		expect(points[1].summary).toBe("first");
	});

	test("ignores snapshots from another session, another reason, or no anchor", () => {
		const snapshots = [
			snapshot({ id: "other-session", entryId: "e1", sessionId: "else" }),
			snapshot({ id: "manual", entryId: "e1", reason: "manual" }),
			snapshot({ id: "unanchored", entryId: null }),
		];
		const points = buildRewindPoints(branch, snapshots, "sess");
		expect(points.every((point) => point.snapshot === undefined)).toBe(true);
	});

	test("keeps the earliest snapshot when several share an anchor", () => {
		const snapshots = [
			snapshot({ id: "later", entryId: "e1", timestamp: 2000 }),
			snapshot({ id: "earlier", entryId: "e1", timestamp: 500 }),
		];
		const [e2, e1] = buildRewindPoints(branch, snapshots, "sess");
		expect(e1.snapshot?.id).toBe("earlier");
		expect(e2.snapshot).toBeUndefined();
	});
});

describe("rewindScopes", () => {
	test("offers code choices only when a snapshot exists", () => {
		const withCode: RewindPoint = { entryId: "e", prompt: "p", summary: "p", timestamp: 0, snapshot: snapshot() };
		const talkOnly: RewindPoint = { entryId: "e", prompt: "p", summary: "p", timestamp: 0 };
		expect(rewindScopes(withCode)).toEqual(["both", "conversation", "code"]);
		expect(rewindScopes(talkOnly)).toEqual(["conversation"]);
	});
});
