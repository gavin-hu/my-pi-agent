/**
 * Render checks for the docs screenshots.
 *
 * Every capture is drawn by a real component around a hand-written fixture, so a
 * renamed field or a changed constructor breaks an image silently: the script
 * still runs, the PNG just stops matching the product. These tests render every
 * frame at a few widths and assert it stays inside the terminal.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CHROME_SCREEN, SCREENS } from "./screenshots.ts";

/** Every capturable frame: the named screens plus the whole-chrome preview. */
const FRAMES = { ...SCREENS, chrome: CHROME_SCREEN };

/** Widths a capture has to survive: a narrow terminal, the default, a wide one. */
const WIDTHS = [46, 80, 120];

describe("screenshots", () => {
	test("asset stems and window titles are unique", () => {
		const frames = Object.entries(FRAMES);
		expect(new Set(frames.map(([, screen]) => screen.asset)).size).toBe(frames.length);
		// The capture finds its window by a title substring, so two screens sharing
		// one would race for the wrong window.
		expect(new Set(frames.map(([, screen]) => screen.title)).size).toBe(frames.length);
		for (const [, screen] of frames) expect(screen.title.trim()).not.toBe("");
	});

	test("every frame renders non-empty and inside the width", () => {
		for (const [name, screen] of Object.entries(FRAMES)) {
			for (const width of WIDTHS) {
				const lines = screen.render(width, 30);
				expect({ name, width, rendered: lines.length > 0 }).toEqual({ name, width, rendered: true });
				const overflow = lines.filter((line) => visibleWidth(line) > width);
				expect({ name, width, overflow: overflow.length }).toEqual({ name, width, overflow: 0 });
			}
		}
	});

	test("a sized frame is no taller than its window rows", () => {
		// A frame longer than the window scrolls the terminal, which silently clips
		// the header line out of the capture.
		for (const [name, screen] of Object.entries(FRAMES)) {
			if (!screen.size) continue;
			const lines = screen.render(screen.size.width, screen.size.rows);
			expect({ name, rows: screen.size.rows, fits: lines.length <= screen.size.rows }).toEqual({
				name,
				rows: screen.size.rows,
				fits: true,
			});
		}
	});
});
