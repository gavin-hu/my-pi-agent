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

/** The record: one fingerprint per captured frame, beside the frames it describes. */
const FRAMES = join(import.meta.dir, "frames.json");

/**
 * The fingerprint of one frame. Escape codes are hashed with the text on
 * purpose: a theme change repaints the picture, so it owes a recapture too.
 */
export function frameFingerprint(lines: string[]): string {
	return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
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
