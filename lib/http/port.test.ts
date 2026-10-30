/**
 * The project port band: one range, and the number a repository keeps inside it.
 *
 * Two pages pick from this band — `/board` and `/browse` — and both extensions' docs state
 * its numbers, so the arithmetic is the contract and the test pins it: 4780–5779, one
 * number per project and the same one on the next start.
 */

import { describe, expect, test } from "bun:test";
import { PORT_BASE, PORT_RANGE, projectPort } from "./port.ts";

describe("the project port band", () => {
	test("starts at 4780 and holds a thousand ports", () => {
		expect(PORT_BASE).toBe(4780);
		expect(PORT_RANGE).toBe(1000);
	});

	test("gives one project one number, whatever else it is asked", () => {
		expect(projectPort("my-pi-agent")).toBe(5647);
		expect(projectPort("repo-a")).toBe(5658);
		// A second project is a second slot, so neither needs a setting to avoid the other.
		expect(projectPort("repo-b")).toBe(5240);
	});

	test("keeps every project's number inside the band", () => {
		for (let project = 0; project < 300; project++) {
			const port = projectPort(`key-${project}`);
			expect(port).toBeGreaterThanOrEqual(PORT_BASE);
			expect(port).toBeLessThan(PORT_BASE + PORT_RANGE);
			expect(Number.isInteger(port)).toBe(true);
		}
	});

	test("spreads projects over the band, so a pair rarely shares a slot", () => {
		const slots = new Set<number>();
		for (let project = 0; project < 300; project++) slots.add(projectPort(`key-${project}`));
		expect(slots.size).toBeGreaterThan(200);
	});
});
