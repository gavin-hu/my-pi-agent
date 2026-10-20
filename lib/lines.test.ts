/**
 * The byte-safe line splitter: chunk boundaries that fall inside a line, or
 * inside a multi-byte character, and the caps that keep a silent stream bounded.
 */

import { describe, expect, test } from "bun:test";
import { LineSplitter, MAX_LINE_BYTES } from "./lines.ts";

describe("LineSplitter", () => {
	test("takes each complete line and keeps the tail", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("one\ntwo\nthree")).toEqual(["one", "two"]);
		expect(splitter.pendingBytes).toBe(5);
		expect(splitter.push(" and four\n")).toEqual(["three and four"]);
	});

	test("keeps a multi-byte character that a chunk boundary splits", () => {
		const splitter = new LineSplitter();
		const bytes = Buffer.from("héllo\n", "utf8");
		// é is two bytes; cut between them, as a pipe read can.
		const cut = bytes.indexOf(0xc3) + 1;
		expect(splitter.push(bytes.subarray(0, cut))).toEqual([]);
		expect(splitter.push(bytes.subarray(cut))).toEqual(["héllo"]);
	});

	test("keeps a four-byte emoji that a chunk boundary splits", () => {
		const splitter = new LineSplitter();
		const bytes = Buffer.from("a🙂b\n", "utf8");
		expect(splitter.push(bytes.subarray(0, 3))).toEqual([]);
		expect(splitter.push(bytes.subarray(3))).toEqual(["a🙂b"]);
	});

	test("leaves a carriage return to the sanitizer instead of breaking on it", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("10%\r50%\rdone\n")).toEqual(["10%\r50%\rdone"]);
	});

	test("keeps the empty line a blank separator produces", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("a\n\nb\n")).toEqual(["a", "", "b"]);
	});

	test("takes nothing from a chunk with no newline", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("partial")).toEqual([]);
		expect(splitter.pendingBytes).toBe(7);
	});

	test("accepts a string chunk as UTF-8", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("string line\n")).toEqual(["string line"]);
	});

	test("ignores an empty chunk", () => {
		const splitter = new LineSplitter();
		expect(splitter.push("")).toEqual([]);
		expect(splitter.pendingBytes).toBe(0);
	});

	test("emits an over-long line at the cap instead of dropping it", () => {
		const splitter = new LineSplitter({ maxLineBytes: 4 });
		expect(splitter.push("abcdefgh")).toEqual(["abcdefgh"]);
		expect(splitter.pendingBytes).toBe(0);
	});

	test("flushes the unfinished line, once", () => {
		const splitter = new LineSplitter();
		splitter.push("no newline");
		expect(splitter.flush()).toEqual(["no newline"]);
		expect(splitter.flush()).toEqual([]);
	});

	test("resets the unfinished line for a truncated source", () => {
		const splitter = new LineSplitter();
		splitter.push("stale");
		splitter.reset();
		expect(splitter.flush()).toEqual([]);
		expect(splitter.push("fresh\n")).toEqual(["fresh"]);
	});

	test("defaults its cap to one megabyte", () => {
		expect(MAX_LINE_BYTES).toBe(1024 * 1024);
	});
});
