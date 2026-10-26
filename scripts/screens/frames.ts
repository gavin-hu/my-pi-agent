/**
 * The frame each shipped capture was taken of (dev tooling).
 *
 * A capture cannot be re-proved pixel for pixel: Terminal.app's subpixel
 * antialiasing differs between two runs of the same code, so a stored image is
 * never byte-identical to a fresh one. What a capture *can* record is the frame
 * that was on screen, so `captureScreen` writes the fingerprint of the frame it
 * drew beside the asset, and `scripts/screenshots.test.ts` fails when the
 * renderer no longer produces it — which is the drift the picture cannot report
 * about itself.
 *
 * Only a screen that pins its `size` is recorded: the capture hands the terminal
 * the frame's columns and rows, so a pinned size is what makes a frame the same
 * frame twice, while an unsized screen is drawn at whatever geometry its window
 * reached.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { now as fixtureNow } from "./fixtures/shared.ts";

/** The record: one fingerprint per captured frame, beside the frames it describes. */
const FRAMES = join(import.meta.dir, "frames.json");

/**
 * Draw one frame with the clock its fixtures were built against.
 *
 * A fixture places a watcher's start at `now - 12m` and the screen prints the age
 * against the wall clock, so a render a second after the picture says `721s` where
 * the picture says `720s`. The capture draws the frame, then re-renders it to record
 * its fingerprint, and the test renders it again: three moments, three texts — which
 * is a frame nobody can reproduce, not a frame that drifted. Freezing the clock for
 * the render makes a frame a pure function of its fixtures, so the picture, the
 * record, and the test are the same frame.
 */
export function frameLines(
	screen: { render(width: number, rows: number): string[] },
	width: number,
	rows: number,
): string[] {
	const wallClock = Date.now;
	Date.now = () => fixtureNow;
	try {
		return screen.render(width, rows);
	} finally {
		Date.now = wallClock;
	}
}

/**
 * The fingerprint of one frame: its text, with the styling stripped.
 *
 * The colors are left out because a frame's escape codes are decided by the
 * terminal that asked for it — Pi's theme layer picks truecolor, 256-color, or
 * none from `TERM` — so a runner can never reproduce the codes of the Mac that
 * captured the picture, and hashing them would fail every job. The text is the
 * part a renderer change moves: it carries Pi's version, every label, the
 * wrapping, and the right-aligned columns. A palette edit is still caught, by
 * the theme's own tests and by eye on the picture it repaints.
 */
export function frameFingerprint(lines: string[]): string {
	const text = lines.map((line) => stripTerminalSequences(line)).join("\n");
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Every recorded frame: screen name to the fingerprint it was captured at. */
export function readFrames(): Record<string, string> {
	const frames: Record<string, string> = {};
	if (!existsSync(FRAMES)) return frames;
	const parsed: unknown = JSON.parse(readFileSync(FRAMES, "utf-8"));
	if (typeof parsed !== "object" || parsed === null) return frames;
	for (const [name, fingerprint] of Object.entries(parsed)) {
		if (typeof fingerprint === "string") frames[name] = fingerprint;
	}
	return frames;
}

/** Record what `name` was captured at, keeping every other screen's entry. */
export function recordFrame(name: string, fingerprint: string): void {
	const sorted = Object.entries({ ...readFrames(), [name]: fingerprint }).sort(([a], [b]) => a.localeCompare(b));
	writeFileSync(FRAMES, `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`);
}
