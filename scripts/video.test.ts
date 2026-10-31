/**
 * The gallery preview's storyboard and command line.
 *
 * `scripts/shots/video.ts` encodes the `pi.video` montage, and it does so by
 * driving a browser, which no test here opens: what is checkable without one is
 * the input — the six slides, their captions, the file's length, and the flags —
 * plus the one thing the page is told to do, which is record H.264. A frame that
 * went missing would encode without it, and the video would assert a picture the
 * package does not ship.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { MONTAGE, montageRequest, montageScript, parseArgs, totalSeconds } from "./shots/video.ts";
import { repo } from "./theme.ts";

/** The storyboard as a page would receive it, with the pictures stubbed out. */
function request() {
	return montageRequest(
		MONTAGE.map((slide) => ({ ...slide, src: "data:image/png;base64," })),
		parseArgs([]),
	);
}

describe("video shot arguments", () => {
	test("defaults to the gallery preview at 1280×720", () => {
		const options = parseArgs([]);
		expect(options.out).toBe(join(repo, "assets", "video", "demo.mp4"));
		expect(options.width).toBe(1280);
		expect(options.height).toBe(720);
		expect(options.fps).toBe(30);
		expect(options.bps).toBe(1_400_000);
	});

	test("flags override the defaults", () => {
		const options = parseArgs([
			"-o",
			"out/preview.mp4",
			"--width",
			"960",
			"--height",
			"540",
			"--fps",
			"24",
			"--bps",
			"900000",
		]);
		expect(basename(options.out)).toBe("preview.mp4");
		expect(options.width).toBe(960);
		expect(options.height).toBe(540);
		expect(options.fps).toBe(24);
		expect(options.bps).toBe(900_000);
	});

	test("refuses a flag it does not have, a canvas nobody can see, and an unplayable rate", () => {
		expect(() => parseArgs(["--theme", "dark"])).toThrow("unknown option --theme");
		expect(() => parseArgs(["--width", "200"])).toThrow("at least 320×240");
		expect(() => parseArgs(["--fps", "0"])).toThrow("--fps must be positive");
		expect(() => parseArgs(["--fps", "90"])).toThrow("--fps must be between 1 and 60");
	});
});

describe("the montage", () => {
	test("names frames the repository carries, each with a caption", () => {
		expect(MONTAGE.length).toBeGreaterThan(1);
		for (const slide of MONTAGE) {
			expect(existsSync(join(repo, "assets", "screens", `${slide.frame}.png`)), slide.frame).toBe(true);
			expect(slide.caption.trim(), slide.frame).not.toBe("");
			expect(slide.seconds, slide.frame).toBeGreaterThan(0);
		}
	});

	test("runs as long as its slides, fades included", () => {
		// Each fade is spent inside its own slide's time, so the sum is the file's
		// length rather than a second number that has to be kept in step.
		expect(request().totalSeconds).toBe(totalSeconds());
		expect(request().totalSeconds).toBe(MONTAGE.reduce((total, slide) => total + slide.seconds, 0));
	});

	test("is recorded as H.264 and handed every slide", () => {
		const script = montageScript(request());
		expect(script).toContain("video/mp4;codecs=avc1");
		for (const slide of MONTAGE) expect(script).toContain(`"frame":"${slide.frame}"`);
	});
});
