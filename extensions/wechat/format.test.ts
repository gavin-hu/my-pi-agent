import { describe, expect, test } from "bun:test";
import {
	chunkText,
	notice,
	parseInbound,
	peerLabel,
	peerLanguage,
	sanitizeInbound,
	toWechatText,
	type NoticeKind,
} from "./format.ts";

describe("sanitizeInbound", () => {
	test("strips control characters and normalizes line endings", () => {
		expect(sanitizeInbound("hi\u0007\r\nthere")).toBe("hi\nthere");
	});

	test("trims surrounding whitespace", () => {
		expect(sanitizeInbound("  hello  ")).toBe("hello");
	});
});

describe("chunkText", () => {
	test("returns the text whole when within the limit", () => {
		expect(chunkText("short", 100)).toEqual(["short"]);
	});

	test("splits on a line break at or before the limit", () => {
		expect(chunkText("aaaa\nbbbb", 6)).toEqual(["aaaa", "bbbb"]);
	});

	test("hard-splits a single long line", () => {
		expect(chunkText("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
	});

	test("returns the text whole for a non-positive limit", () => {
		expect(chunkText("abcdefgh", 0)).toEqual(["abcdefgh"]);
	});
});

describe("peerLabel", () => {
	test("drops the im.wechat suffix", () => {
		expect(peerLabel("wxid_1@im.wechat")).toBe("wxid_1");
	});

	test("leaves an id without the suffix unchanged", () => {
		expect(peerLabel("wxid_1")).toBe("wxid_1");
	});
});

describe("parseInbound", () => {
	test("concatenates text items and sanitizes them", () => {
		const result = parseInbound([
			{ type: 1, text_item: { text: "hi" } },
			{ type: 1, text_item: { text: "there\u0007" } },
		]);
		expect(result.text).toBe("hi\nthere");
		expect(result.media).toEqual([]);
	});

	test("uses a voice transcript as text", () => {
		const result = parseInbound([{ type: 3, voice_item: { text: "spoken words" } }]);
		expect(result.text).toBe("spoken words");
	});

	test("collects an image with its hex key", () => {
		const result = parseInbound([{ type: 2, image_item: { media: { encrypt_query_param: "p" }, aeskey: "ab" } }]);
		expect(result.media).toEqual([{ kind: "image", media: { encrypt_query_param: "p" }, aeskey: "ab" }]);
	});

	test("collects a file with its sanitized name", () => {
		const result = parseInbound([
			{ type: 4, file_item: { media: { full_url: "https://cdn/f" }, file_name: "a/b.txt" } },
		]);
		expect(result.media).toEqual([{ kind: "file", media: { full_url: "https://cdn/f" }, fileName: "a_b.txt" }]);
	});

	test("counts video and unknown-but-unreadable items as unsupported", () => {
		const result = parseInbound([{ type: 5, video_item: { media: { full_url: "https://cdn/v" } } }, { type: 99 }]);
		expect(result.text).toBe("");
		expect(result.media).toEqual([]);
		// Video is something a peer meant to send; type 99 is not.
		expect(result.unsupported).toBe(1);
	});

	test("counts a voice note without a transcript as unsupported", () => {
		const result = parseInbound([{ type: 3, voice_item: { media: { full_url: "https://cdn/v" } } }]);
		expect(result.text).toBe("");
		expect(result.unsupported).toBe(1);
	});

	test("keeps a media-only message with empty text", () => {
		const result = parseInbound([{ type: 2, image_item: { media: { full_url: "https://cdn/i" } } }]);
		expect(result.text).toBe("");
		expect(result.media).toHaveLength(1);
	});

	test("skips media without a usable reference", () => {
		const result = parseInbound([{ type: 2, image_item: { media: {} } }]);
		expect(result.media).toEqual([]);
	});
});

describe("toWechatText", () => {
	test("drops fences and keeps the code block body verbatim", () => {
		const text = toWechatText(["Look:", "```ts", "const a = `x`;", "```"].join("\n"));
		// The fence line goes; the body loses only its inline backticks.
		expect(text).toBe("Look:\nconst a = x;");
	});

	test("strips heading, emphasis, and inline-code markers", () => {
		expect(toWechatText("## Plan\n**bold** and __also__ and `code` and ~~gone~~")).toBe(
			"Plan\nbold and also and code and gone",
		);
	});

	test("removes control characters and collapses blank runs", () => {
		expect(toWechatText("a\u0007\n\n\n\nb")).toBe("a\n\nb");
	});

	test("leaves plain text alone", () => {
		expect(toWechatText("it is a cat")).toBe("it is a cat");
	});
});

describe("peerLanguage", () => {
	test("reports Chinese for CJK text and English otherwise", () => {
		expect(peerLanguage("你好，帮我看看")).toBe("zh");
		expect(peerLanguage("please take a look")).toBe("en");
		expect(peerLanguage("1")).toBe("en");
	});
});

describe("notice", () => {
	const KINDS: NoticeKind[] = ["ack", "overflow", "media", "unsupported", "stopped", "timeout", "failed", "newBusy"];

	test("renders the peer's language only", () => {
		const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/;
		for (const kind of KINDS) {
			expect(cjk.test(notice(kind, "zh"))).toBe(true);
			expect(cjk.test(notice(kind, "en"))).toBe(false);
		}
	});

	test("fills in a count", () => {
		expect(notice("media", "en", 2)).toBe("Couldn't open 2 attachment(s) — please resend or describe it.");
		expect(notice("media", "zh", 2)).toContain("2 个附件");
	});

	test("keeps every notice to one line", () => {
		for (const kind of KINDS) {
			for (const lang of ["en", "zh"] as const) expect(notice(kind, lang)).not.toContain("\n");
		}
	});
});
