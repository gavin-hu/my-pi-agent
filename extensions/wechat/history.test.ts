import { describe, expect, test } from "bun:test";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../../test/helpers/env.ts";
import { formatHistory, HISTORY_LINE_CHARS, readPeerHistory } from "./history.ts";
import { peerSessionDir } from "./peer-session.ts";

const peer = "alice@im.wechat";

function message(role: "user" | "assistant", content: unknown, id: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-10-18T00:00:00.000Z",
		message: { role, content, timestamp: 1 },
	} as unknown as SessionEntry;
}

function assistantText(text: string, id: string): SessionEntry {
	return message("assistant", [{ type: "text", text }], id);
}

describe("formatHistory", () => {
	test("prints one line per user/assistant message, oldest first", () => {
		const entries = [message("user", "hello\nworld", "1"), assistantText("hi there", "2")];
		expect(formatHistory(entries, 8)).toBe("You: hello world\nMe: hi there");
	});

	test("keeps only the requested tail", () => {
		const entries = [message("user", "one", "1"), assistantText("two", "2"), message("user", "three", "3")];
		expect(formatHistory(entries, 2)).toBe("Me: two\nYou: three");
	});

	test("elides a long message", () => {
		const long = "x".repeat(HISTORY_LINE_CHARS + 20);
		const line = formatHistory([message("user", long, "1")], 1);
		expect(line.length).toBe(`You: `.length + HISTORY_LINE_CHARS);
		expect(line.endsWith("…")).toBe(true);
	});

	test("ignores non-message entries and empty text", () => {
		expect(formatHistory([{ type: "label", id: "1", parentId: null, timestamp: "", label: "x" } as never], 8)).toBe("");
		expect(formatHistory([message("user", "   ", "1")], 8)).toBe("");
	});
});

describe("readPeerHistory", () => {
	test("reads the newest session from the peer's directory without creating one", async () => {
		const root = tempDir("wechat-history-");
		const manager = SessionManager.create(root, peerSessionDir(root, peer));
		manager.appendMessage({ role: "user", content: "hello", timestamp: 1 } as never);
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi there" }],
			api: "x",
			provider: "x",
			model: "m",
			usage: {},
			stopReason: "stop",
			timestamp: 2,
		} as never);

		expect(await readPeerHistory(root, root, peer, 8)).toBe("You: hello\nMe: hi there");
	});

	test("returns an empty string when the peer has no session", async () => {
		const root = tempDir("wechat-history-");
		expect(await readPeerHistory(root, root, "nobody@im.wechat", 8)).toBe("");
	});
});
