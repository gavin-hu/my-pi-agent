import { describe, expect, test } from "bun:test";
import { chunkText, peerLabel, sanitizeInbound } from "./format.ts";

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
