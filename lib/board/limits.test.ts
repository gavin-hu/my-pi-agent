/**
 * The WIP limits: the numbers a board enforces, where they are read from, and the one
 * sentence a full lane refuses with.
 *
 * A limit is only a gate if the refusal names the number and the way out, so the cases
 * here are about the sentence as much as the count — and about a misconfigured file
 * falling back rather than freezing a board.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { Card } from "./card.ts";
import { countIn, DEFAULT_WIP, limitOf, MAX_WIP, normalizeWip, readWip, wipRefusal } from "./limits.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** `n` cards in one lane, which is all a count needs. */
function cards(lane: Card["lane"], count: number): Card[] {
	return Array.from({ length: count }, () => ({ lane }) as Card);
}

describe("normalizeWip", () => {
	test("an absent setting keeps the defaults", () => {
		expect(normalizeWip(undefined)).toEqual({ plan: 3, execute: 5 });
		expect(DEFAULT_WIP).toEqual({ plan: 3, execute: 5 });
	});

	test("clamps into range, and a missing key keeps the default it had", () => {
		expect(normalizeWip({ plan: 1 })).toEqual({ plan: 1, execute: 5 });
		expect(normalizeWip({ plan: 0, execute: 99 })).toEqual({ plan: 1, execute: MAX_WIP });
		expect(normalizeWip({ plan: "4", execute: 2.6 })).toEqual({ plan: 4, execute: 3 });
		// A value that says nothing is not a zero: it is the default.
		expect(normalizeWip({ plan: null, execute: "lots" })).toEqual({ plan: 3, execute: 5 });
	});
});

describe("readWip", () => {
	test("reads board.wip from the project's bytefly.json", () => {
		const cwd = temps.track(tempDir("pi-wip-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ board: { wip: { plan: 2, execute: 4 } } }));
		expect(readWip(cwd, { agentDir: temps.track(tempDir("pi-wip-agent-")) })).toEqual({ plan: 2, execute: 4 });
	});

	test("a malformed file is the default board, not a broken one", () => {
		const cwd = temps.track(tempDir("pi-wip-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		expect(readWip(cwd, { agentDir: temps.track(tempDir("pi-wip-agent-")) })).toEqual(DEFAULT_WIP);
	});
});

describe("limitOf and countIn", () => {
	test("only the pulled lanes are limited", () => {
		expect(limitOf("plan", DEFAULT_WIP)).toBe(3);
		expect(limitOf("execute", DEFAULT_WIP)).toBe(5);
		expect(limitOf("backlog", DEFAULT_WIP)).toBeUndefined();
		expect(limitOf("blocked", DEFAULT_WIP)).toBeUndefined();
		expect(limitOf("done", DEFAULT_WIP)).toBeUndefined();
	});

	test("counts one lane, not the board", () => {
		expect(countIn("execute", [...cards("execute", 2), ...cards("plan", 1)])).toBe(2);
	});
});

describe("wipRefusal", () => {
	test("says nothing while the lane has room", () => {
		expect(wipRefusal("plan", cards("plan", 2), DEFAULT_WIP)).toBeUndefined();
	});

	test("names the count, the limit, and the ways out", () => {
		expect(wipRefusal("plan", cards("plan", 3), DEFAULT_WIP)).toBe(
			"3 cards are already being planned (the limit is 3); finish, block, or release one first.",
		);
		expect(wipRefusal("execute", cards("execute", 5), DEFAULT_WIP)).toBe(
			"5 cards are already executing (the limit is 5); finish, block, or release one first.",
		);
	});

	test("a configured limit is the one the sentence states", () => {
		expect(wipRefusal("execute", cards("execute", 2), { plan: 3, execute: 2 })).toContain("the limit is 2");
	});
});
