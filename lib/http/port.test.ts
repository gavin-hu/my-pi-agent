/**
 * The per-session port band: one range, and a draw that stays inside it.
 *
 * Two pages pick from this band — `/board` and `/browse` — and both extensions' docs state
 * its numbers, so the arithmetic is the contract and the test pins it: 4780–5779.
 */

import { describe, expect, test } from "bun:test";
import { PORT_BASE, PORT_RANGE, randomPort } from "./port.ts";

describe("the per-session port band", () => {
	test("starts at 4780 and holds a thousand ports", () => {
		expect(PORT_BASE).toBe(4780);
		expect(PORT_RANGE).toBe(1000);
	});

	test("draws a whole port inside it", () => {
		for (let draw = 0; draw < 200; draw++) {
			const port = randomPort();
			expect(port).toBeGreaterThanOrEqual(PORT_BASE);
			expect(port).toBeLessThan(PORT_BASE + PORT_RANGE);
			expect(Number.isInteger(port)).toBe(true);
		}
	});
});
