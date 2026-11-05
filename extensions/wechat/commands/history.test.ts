/**
 * `/history`'s formatting: which messages a line set carries, how long one line may
 * be, and how that length is counted.
 *
 * The entries are shapers of the SDK's `SessionEntry`, so the cases prove the format
 * without a session file on disk.
 */

import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { formatHistory, HISTORY_LINE_CHARS } from "./history.ts";

/** One user or assistant message entry, as the session branch stores it. */
function entryOf(role: "user" | "assistant", text: string): SessionEntry {
	return {
		type: "message",
		id: `${role}-1`,
		parentId: null,
		timestamp: "2026-11-04T00:00:00.000Z",
		message: { role, content: text, timestamp: 1 },
	} as unknown as SessionEntry;
}

describe("formatHistory", () => {
	test("a count of zero or less prints nothing", () => {
		const entries = [entryOf("user", "one"), entryOf("assistant", "two")];
		expect(formatHistory(entries, 0)).toBe("");
		expect(formatHistory(entries, -1)).toBe("");
	});

	test("an elided line is counted in code points, so a pair is never split", () => {
		const long = "👍".repeat(HISTORY_LINE_CHARS + 5);
		const line = formatHistory([entryOf("user", long)], 1);
		expect(line).toBe(`You: ${"👍".repeat(HISTORY_LINE_CHARS - 1)}…`);
		expect([...line].length).toBe("You: ".length + HISTORY_LINE_CHARS);
	});

	test("labels each side in the peer's language", () => {
		const entries = [entryOf("user", "你好"), entryOf("assistant", "你好，需要什么？")];
		expect(formatHistory(entries, 2, "zh")).toBe("你: 你好\n我: 你好，需要什么？");
		// The default stays English for a caller that reads no language, such as the
		// terminal's `/wechat history`.
		expect(formatHistory(entries, 2)).toBe("You: 你好\nMe: 你好，需要什么？");
	});
});
