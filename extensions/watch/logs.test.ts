/**
 * What a watcher keeps: the raw tail bounded in lines and in bytes, and the matches it hands back.
 *
 * The byte bound is the half `maxLogLines` left open, and its exception is the case that matters:
 * the newest line stays even when it alone is over budget, because a tail that emptied itself
 * would read as a broken watcher rather than as a bound that held. These own the module directly —
 * no child, no clock — which is why they are here and not in `runtime.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type WatchConfig } from "./config.ts";
import { createRetention } from "./logs.ts";

/** The default config with one bound moved, so a case says only what it is about. */
function config(overrides: Partial<WatchConfig> = {}): WatchConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

describe("watch retention", () => {
	test("bounds the raw tail by bytes, keeping the newest line whole", () => {
		// Two 150-byte lines against 100 bytes: the older one goes, the newer stays whole even
		// though it alone is over. A longer line is kept whole as well and printed clipped to 200
		// characters, which is the surface's rule and not this bound's.
		const retain = createRetention(config({ maxLogBytes: 100 }));
		retain.push("a".repeat(150));
		retain.push("b".repeat(150));

		const tail = retain.raw(50);
		expect(tail.lines).toEqual(["b".repeat(150)]);
		expect(tail.truncated).toBe(true);
	});

	test("the byte bound drops lines before the line bound does", () => {
		// 32 bytes a line against 1 024 bytes: 32 lines fit and the 33rd evicts the first, long
		// before `maxLogLines` 500 is anywhere near.
		const retain = createRetention(config({ maxLogLines: 500, maxLogBytes: 1_024 }));
		for (let n = 0; n < 40; n++) retain.push(`${String(n).padStart(3, "0")}${"x".repeat(29)}`);

		const lines = retain.raw(500).lines;
		expect(lines).toHaveLength(32);
		expect(lines[0]).toStartWith("008");
		expect(lines.at(-1)).toStartWith("039");
	});

	test("a byte budget with room leaves the line bound binding", () => {
		// The other half: a budget nobody reaches must not quietly retire `maxLogLines`.
		const retain = createRetention(config({ maxLogLines: 3, maxLogBytes: 1_048_576 }));
		for (const line of ["one", "two", "three", "four"]) retain.push(line);

		expect(retain.raw(500).lines).toEqual(["two", "three", "four"]);
	});

	test("keeps the newest matches and reports them unread until marked", () => {
		const retain = createRetention(config({ maxMatches: 2 }));
		retain.keep("first", 1);
		retain.keep("second", 2);
		retain.keep("third", 3);

		expect(retain.matches(500).lines).toEqual(["second", "third"]);
		expect(retain.unread().map((match) => match.line)).toEqual(["second", "third"]);
		expect(retain.allSeen()).toBe(false);

		retain.markSeen(new Set([2, 3]));
		expect(retain.unread()).toEqual([]);
		expect(retain.allSeen()).toBe(true);
	});
});
