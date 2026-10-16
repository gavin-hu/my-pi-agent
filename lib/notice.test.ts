import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { NOTICE_TYPE, isNotice, noticeMessage, pruneStaleNotices } from "./notice.ts";

/** A stored notice as the session would hand it back. */
const notice = (source: string, content = source): AgentMessage =>
	({
		role: "custom",
		...noticeMessage({ content, details: { source, title: content } }),
		timestamp: 0,
	}) as unknown as AgentMessage;

const user = { role: "user", content: "hi", timestamp: 0 } as unknown as AgentMessage;

describe("noticeMessage", () => {
	test("stamps the shared type, display true, and both halves", () => {
		const message = noticeMessage({ content: "3 jobs finished", details: { source: "job", title: "3 jobs finished" } });
		expect(message.customType).toBe(NOTICE_TYPE);
		expect(message.display).toBe(true);
		expect(message.content).toBe("3 jobs finished");
		expect(message.details.source).toBe("job");
	});
});

describe("isNotice", () => {
	test("accepts our notices and rejects everything else", () => {
		expect(isNotice(notice("job"))).toBe(true);
		expect(isNotice(user)).toBe(false);
		expect(
			isNotice({ role: "custom", customType: "other", content: "x", display: false, timestamp: 0 } as AgentMessage),
		).toBe(false);
	});
});

describe("pruneStaleNotices", () => {
	test("keeps only the newest notice of the given source", () => {
		const messages = [user, notice("job", "old"), notice("watch", "seen"), notice("job", "new")];
		const pruned = pruneStaleNotices(messages, "job");
		expect(pruned).toHaveLength(3);
		expect(pruned).toContain(messages[0]);
		expect(pruned).toContain(messages[2]);
		expect(pruned?.filter((message) => isNotice(message) && message.details?.source === "job")).toEqual([messages[3]]);
	});

	test("leaves other sources untouched", () => {
		expect(pruneStaleNotices([notice("watch", "a"), notice("watch", "b")], "job")).toBeUndefined();
	});

	test("returns undefined when nothing is stale", () => {
		expect(pruneStaleNotices([user, notice("job")], "job")).toBeUndefined();
	});
});
