/**
 * Render and pricing gates for a long transcript.
 *
 * The benchmark's wall-clock and heap readings depend on the machine and are
 * read by a person, so this suite pins only the properties that are wrong on any
 * machine: a repeat frame must be the same lines, every line must fit its width,
 * most blocks must come back from their render memo, and a re-price of the same
 * records must produce the same totals.
 */

import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { createPricer } from "../extensions/bytefly/footer/price/price.ts";
import {
	cacheHits,
	deterministic,
	fitsWidth,
	frame,
	priceConfig,
	priceRecords,
	priceStable,
	session,
} from "./render-bench.ts";

/**
 * Blocks the gate renders. Enough to be a long transcript, small enough that
 * every platform's suite keeps it fast; the script covers 2000 for a release
 * reading.
 */
const GATE_BLOCKS = 500;

/** A block whose lines are whatever `render` returns, for the rejected case. */
function block(render: () => string[]): Component {
	return { render, invalidate: () => {} } as unknown as Component;
}

describe("long-session frames", () => {
	for (const width of [80, 120]) {
		test(`a repeat frame at ${width} columns is the same lines`, () => {
			const components = session(GATE_BLOCKS);
			const first = frame(components, width);
			const second = frame(components, width);
			expect(second).toEqual(first);
		});

		test(`every line fits ${width} columns`, () => {
			const overflowing = frame(session(GATE_BLOCKS), width).filter((line) => visibleWidth(line) > width);
			expect(overflowing).toEqual([]);
		});
	}

	test("most blocks come back from their render memo on a repeat frame", () => {
		const components = session(GATE_BLOCKS);
		// The memo is the frame's fast path: a wrapper that rebuilds every block
		// would drop this well below half.
		expect(cacheHits(components, 120)).toBeGreaterThan(components.length / 2);
	});

	test("the determinism gate rejects a block that changes between frames", () => {
		let rendered = 0;
		expect(deterministic([block(() => [`frame ${(rendered += 1)}`])], 80)).toBe(false);
		expect(deterministic([block(() => ["same line"])], 80)).toBe(true);
	});

	test("the width gate rejects an overflowing line", () => {
		expect(fitsWidth(["x".repeat(81)], 80)).toBe(false);
		expect(fitsWidth(["x".repeat(80)], 80)).toBe(true);
	});
});

describe("session pricing", () => {
	test("a re-price of the same records is deterministic", () => {
		expect(priceStable(priceRecords(200), priceConfig("default"))).toBe(true);
	});

	test("an unrelated wide table prices no cost but still totals tokens", () => {
		const totals = createPricer(priceConfig("wide"))(priceRecords(10));
		expect(totals.cost).toBe(0);
		expect(totals.input).toBe(10_000);
		expect(totals.cacheRead).toBe(200_000);
	});
});
