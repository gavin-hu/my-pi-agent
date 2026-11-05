/**
 * The text the bridge turns a message into, and a reply back into.
 *
 * These cases live with `text/format.ts` rather than in the status-screen suite
 * they grew up in: inbound sanitizing and parsing, Markdown flattening, and the
 * chunking that keeps a long reply inside one message's budget.
 */

import { describe, expect, test } from "bun:test";
import {
	chunkText,
	codePointSlice,
	oneLine,
	parseInbound,
	peerKey,
	peerLabel,
	peerLanguage,
	sanitizeInbound,
	toWechatText,
} from "./format.ts";

describe("inbound text", () => {
	test("sanitizes control characters, line endings, and surrounding space", () => {
		expect(sanitizeInbound("hi\u0007\r\nthere")).toBe("hi\nthere");
		expect(sanitizeInbound("  hello  ")).toBe("hello");
	});

	test("labels a peer without the im.wechat suffix", () => {
		expect(peerLabel("wxid_1@im.wechat")).toBe("wxid_1");
		expect(peerLabel("wxid_1")).toBe("wxid_1");
	});

	test("keys either id form by normalized case and suffix", () => {
		expect(peerKey(" Alice@IM.WeChat ")).toBe("alice");
		expect(peerKey("alice")).toBe("alice");
	});

	test("chunks at a line break or by force, and keeps a short text whole", () => {
		expect(chunkText("short", 100)).toEqual(["short"]);
		expect(chunkText("aaaa\nbbbb", 6)).toEqual(["aaaa", "bbbb"]);
		expect(chunkText("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
		expect(chunkText("abcdefgh", 0)).toEqual(["abcdefgh"]);
	});

	test("never cuts a surrogate pair in half", () => {
		// Five code units is two emoji and a half: the cut backs off, so no message
		// carries half a character and the pieces still spell the original.
		const chunks = chunkText("👍👍👍xxxxxxxxxx", 5);
		for (const chunk of chunks) expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
		for (const chunk of chunks) expect(chunk).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
		expect(chunks.join("")).toBe("👍👍👍xxxxxxxxxx");
		expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
	});

	test("answers in Chinese for CJK text and English otherwise", () => {
		expect(peerLanguage("你好，帮我看看")).toBe("zh");
		expect(peerLanguage("please take a look")).toBe("en");
		expect(peerLanguage("1")).toBe("en");
	});
});

describe("counting in code points", () => {
	test("counts an astral character once, not twice", () => {
		expect(codePointSlice("👍👍👍", 2)).toEqual({ slice: "👍👍", total: 3 });
	});

	test("returns the text whole when it fits, and nothing at zero", () => {
		expect(codePointSlice("abc", 10)).toEqual({ slice: "abc", total: 3 });
		expect(codePointSlice("abc", 3)).toEqual({ slice: "abc", total: 3 });
		expect(codePointSlice("abc", 0)).toEqual({ slice: "", total: 3 });
	});

	test("a cut at the boundary keeps the pair whole", () => {
		expect(codePointSlice("ab👍cd", 3)).toEqual({ slice: "ab👍", total: 5 });
	});

	test("one line keeps a title's first line and elides the rest", () => {
		expect(oneLine("Plan ready for review\n1. Add parseConfig\nApprove?", 80)).toBe("Plan ready for review");
		expect(oneLine("  Welcome  ", 80)).toBe("Welcome");
		// Cut at the bound with one ellipsis, and the ellipsis is not inside it.
		expect(oneLine("x".repeat(20), 12)).toBe(`${"x".repeat(12)}…`);
	});
});

describe("flattening Markdown for a chat window", () => {
	test("drops fences and keeps the code block body verbatim", () => {
		const text = toWechatText(["Look:", "```ts", "const a = `x`;", "```"].join("\n"));
		expect(text).toBe("Look:\nconst a = `x`;");
	});

	test("does not rewrite Markdown-looking lines inside a fence", () => {
		const text = toWechatText(
			["```bash", "# not a heading", "echo `date` **bold** ~~gone~~", "```", "## Heading"].join("\n"),
		);
		expect(text).toBe("# not a heading\necho `date` **bold** ~~gone~~\nHeading");
	});

	test("keeps blank runs inside a fence but collapses them outside", () => {
		const text = toWechatText(["```", "a", "", "", "b", "```", "", "", "c"].join("\n"));
		expect(text).toBe("a\n\n\nb\n\nc");
	});

	test("strips heading, emphasis, and inline-code markers", () => {
		expect(toWechatText("## Plan\n**bold** and __also__ and `code` and ~~gone~~")).toBe(
			"Plan\nbold and also and code and gone",
		);
	});

	test("removes control characters, collapses blank runs, and leaves plain text alone", () => {
		expect(toWechatText("a\u0007\n\n\n\nb")).toBe("a\n\nb");
		expect(toWechatText("it is a cat")).toBe("it is a cat");
	});
});

describe("parsing an inbound message", () => {
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

	test("keeps a media-only message with empty text and skips an unusable reference", () => {
		const image = parseInbound([{ type: 2, image_item: { media: { full_url: "https://cdn/i" } } }]);
		expect(image.text).toBe("");
		expect(image.media).toHaveLength(1);
		expect(parseInbound([{ type: 2, image_item: { media: {} } }]).media).toEqual([]);
	});
});
