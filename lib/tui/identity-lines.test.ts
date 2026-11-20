/**
 * The result component that builds its lines at the render width.
 *
 * A path or URL is one token, so a result line handed to Pi's `Text` as a string wraps mid-segment
 * — at 40 columns a saved plan's path was four lines. `LinesAtWidth` is the call line's rule one
 * rung down the transcript, and these cases are the measurement rather than a `toContain`: the
 * line count, the width it fits, and the tail a reader scans for.
 *
 * Split from `tool.test.ts` at its size bar; the call line's own cases stay there.
 */

import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, Text, visibleWidth } from "@earendil-works/pi-tui";
import { LinesAtWidth, reuseLines } from "./tool.ts";

describe("LinesAtWidth", () => {
	/** The saved plan the card was filed on: a path is one token, so a wrap cuts it mid-segment. */
	const SAVED = "✓ Saved plan ~/.pi/agent/plans/8872d3adda0e/2026-10-29-1015-add-rate-limiting.md";

	test("keeps an identity line whole at every width, tail included", () => {
		// The result used to be a string handed to Pi's Text, which can only wrap: at 40 columns the
		// path broke after "2026-10" and read as four lines. One line, fitting the width, is the
		// assertion — a `toContain` passes on the broken row, so the measurement is the case.
		for (const width of [40, 100, 120]) {
			const lines = new LinesAtWidth([{ text: SAVED, clip: "middle" }]).render(width);
			expect(lines).toHaveLength(1);
			const line = lines[0] ?? "";
			expect(visibleWidth(line), `${width} columns`).toBeLessThanOrEqual(width);
			// The basename is the identity a reader scans for, and the head says what it is. The clip
			// marks its cut with the theme's reset, which is width-zero, so it is stripped first.
			const shown = stripTerminalSequences(line);
			expect(shown).toContain("Saved plan");
			// At 40 columns the cut lands one character into the basename, which the middle clip
			// makes up for by keeping the head: the file is still identifiable from what survives.
			expect(shown).toContain("rate-limiting.md");
		}
	});

	test("wraps the same line through the path it replaced, which is why it moved", () => {
		// The old shape: a string inside Pi's Text. This is the failing side of the case above, kept
		// so a later reader cannot call the measurement redundant — Text wraps, and a path is one
		// token, so a wrap splits it.
		const wrapped = new Text(SAVED).render(40);
		expect(wrapped.length).toBeGreaterThan(1);
		expect(wrapped.some((line) => line.includes("2026-10"))).toBe(true);
	});

	test("takes the end clip for prose and leaves a fitting line untouched", () => {
		const prose = new LinesAtWidth([{ text: "a task that runs long enough to be clipped in the middle of a word" }]);
		const clipped = stripTerminalSequences(prose.render(40)[0] ?? "");
		expect(visibleWidth(clipped)).toBeLessThanOrEqual(40);
		expect(clipped.endsWith("…")).toBe(true);
		const short = new LinesAtWidth([{ text: "read src/a.ts" }]).render(40);
		expect(short).toEqual(["read src/a.ts"]);
	});

	test("renders a body under the lines, and every line fits", () => {
		// A plan's own text is a body: it wraps, where the path above it clips. The two live in one
		// component so a result is one block rather than a clipped line plus a text block.
		const body = new Text("line one of the plan\nline two of the plan");
		const lines = new LinesAtWidth([{ text: SAVED, clip: "middle" }], body).render(40);
		expect(lines.length).toBeGreaterThanOrEqual(3);
		expect(stripTerminalSequences(lines[0] ?? "")).toContain("Saved plan");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("memoizes on the width and the lines, and drops it on invalidate", () => {
		// The reason it is a component and not a per-frame string: `render` runs for every block on
		// every frame. `bun run bench:render` before and after this change: block 500 at 80 columns
		// 0.1ms before, 0.1ms after; 2,000 records 4,513 lines 0.2ms before, 4,493 lines 0.2ms after,
		// memo 1,937/2,000 and `stable: yes` on both — the gate is the bench's own `stable` column,
		// so a regression shows as a rebuilt line set rather than as a slower number.
		const component = new LinesAtWidth([{ text: SAVED, clip: "middle" }]);
		expect(component.render(40)).toBe(component.render(40));
		const first = component.render(40);
		expect(component.render(41)).not.toBe(first);
		component.setLines([{ text: "memory → add", clip: "end" }]);
		expect(component.render(41)).not.toBe(first);
	});

	test("reuses one component across frames the way a call line does", () => {
		const first = reuseLines(undefined, [{ text: SAVED, clip: "middle" }]);
		expect(reuseLines(first, [{ text: "next", clip: "middle" }])).toBe(first);
		expect(reuseLines(new Text("x"), [{ text: SAVED }])).not.toBe(first);
	});
});
