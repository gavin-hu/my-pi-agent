import { describe, expect, test } from "bun:test";
import { chunkText, parseInbound, peerLabel, sanitizeInbound } from "./format.ts";

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

	test("ignores video and unknown items", () => {
		const result = parseInbound([{ type: 5, video_item: { media: { full_url: "https://cdn/v" } } }, { type: 99 }]);
		expect(result.text).toBe("");
		expect(result.media).toEqual([]);
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
