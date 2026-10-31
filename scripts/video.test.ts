/**
 * The gallery preview's storyboard, geometry, and command line.
 *
 * `scripts/shots/video.ts` encodes the `pi.video` tour, and it does so by driving a
 * browser, which no test here opens: what is checkable without one is everything the page
 * is handed — the slides, the stage, where each picture sits, the palette, the words — plus
 * the one thing the page is told to do, which is record H.264. The geometry is computed
 * here rather than in the page string for this reason: a hero that scrolled, or a gallery
 * that did not, would be a video asserting a picture the package does not ship.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { WEB_THEME_TOKENS } from "../lib/web/tokens.ts";
import {
	MONTAGE,
	PAGE_FRAMES,
	chromeFor,
	layout,
	packageVersion,
	pagePalette,
	pngSize,
	slides,
	stillTimes,
	totalSeconds,
} from "./shots/montage.ts";
import { montageRequest, montageScript, parseArgs } from "./shots/video.ts";
import { repo } from "./theme.ts";

/** The storyboard as a page receives it: the real frames, with the pictures stubbed out. */
function request(options = parseArgs([]), stills?: number[]) {
	return montageRequest(
		slides().map((slide) => ({ ...slide, src: "data:image/png;base64," })),
		options,
		stills,
	);
}

describe("video shot arguments", () => {
	test("defaults to the gallery preview at 1280×720 and one megabit", () => {
		const options = parseArgs([]);
		expect(options.out).toBe(join(repo, "assets", "video", "demo.mp4"));
		expect(options.width).toBe(1280);
		expect(options.height).toBe(720);
		expect(options.fps).toBe(30);
		expect(options.bps).toBe(1_000_000);
		expect(options.stills).toBeUndefined();
	});

	test("flags override the defaults", () => {
		const options = parseArgs([
			"-o",
			"out/preview.mp4",
			"--stills",
			"out/stills",
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
		expect(options.stills?.endsWith(join("out", "stills"))).toBe(true);
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

describe("the storyboard", () => {
	test("names frames the repository carries, each with a kicker and a caption", () => {
		expect(MONTAGE.length).toBeGreaterThan(1);
		for (const slide of MONTAGE) {
			expect(existsSync(join(repo, "assets", "screens", `${slide.frame}.png`)), slide.frame).toBe(true);
			expect(slide.kicker.trim(), slide.frame).not.toBe("");
			expect(slide.caption.trim(), slide.frame).not.toBe("");
			expect(slide.seconds, slide.frame).toBeGreaterThan(0);
		}
	});

	test("runs between 25 and 30 seconds, and stays small enough to autoplay", () => {
		// The gallery starts the file on its own, so its length and its bitrate are a
		// budget rather than two free choices: a slide added here pays for itself.
		const seconds = totalSeconds();
		expect(seconds).toBeGreaterThanOrEqual(25);
		expect(seconds).toBeLessThanOrEqual(30);
		expect((seconds * parseArgs([]).bps) / 8).toBeLessThan(4_000_000);
		expect(request().totalSeconds).toBe(MONTAGE.reduce((total, slide) => total + slide.seconds, 0));
	});

	test("scrolls only the frames that are taller than the stage", () => {
		// A whole window is shown whole; a page or a gallery that outgrows the stage
		// fills its width and travels, which is the only way the 12 466px sheet reads.
		const { picture, stage } = chromeFor({ width: 1280, height: 720 });
		const frames = request().frames;
		for (const frame of frames) {
			if (frame.scroll === true) expect(frame.layout.height, frame.frame).toBeGreaterThan(picture.h);
			else expect(frame.layout.travel, frame.frame).toBe(0);
			expect(frame.layout.travel, frame.frame).toBeLessThanOrEqual(picture.h * 1.25);
			expect(frame.layout.x, frame.frame).toBeGreaterThanOrEqual(picture.x);
			expect(frame.layout.y, frame.frame).toBeGreaterThanOrEqual(stage.y);
		}
		expect(frames.some((frame) => frame.layout.travel > 0)).toBe(true);
	});

	test("trims the title bar off a terminal frame and nothing off a page", () => {
		for (const frame of slides()) {
			expect(frame.trim, frame.frame).toBe(PAGE_FRAMES.has(frame.frame) ? 0 : 8);
			expect(frame.width, frame.frame).toBeGreaterThan(320);
			expect(frame.height, frame.frame).toBeGreaterThan(160);
		}
	});
});

describe("the stage", () => {
	test("is the same box at 720p whatever the slide", () => {
		const chrome = chromeFor({ width: 1280, height: 720 });
		expect(chrome.margin).toBe(56);
		expect(chrome.stage).toEqual({ x: 56, y: 64, w: 1168, h: 548 });
		expect(chrome.picture).toEqual({ x: 70, y: 78, w: 1140, h: 520 });
		expect(chrome.brandBaseline).toBe(40);
		expect(chrome.progressY).toBe(628);
		expect(chrome.captionBaseline).toBe(694);
	});

	test("scales with the canvas, so a 540p encode is the same design", () => {
		const half = chromeFor({ width: 960, height: 540 });
		expect(half.margin).toBe(42);
		expect(half.fonts.caption).toBe(18);
		expect(half.progressY).toBe(471);
	});

	test("fits a picture whole, or fills the width when it is told to scroll", () => {
		const box = { x: 70, y: 78, w: 1140, h: 520 };
		const tall = layout({ width: 1000, height: 4000 }, box, { trim: 0, scroll: true });
		expect(tall.width).toBe(1140);
		expect(tall.travel).toBe(650);
		const strip = layout({ width: 2000, height: 400 }, box, { trim: 0, scroll: false });
		expect(strip.width).toBe(1140);
		expect(strip.height).toBeCloseTo(228, 6);
		expect(strip.travel).toBe(0);
	});

	test("reads a PNG's size from its header and refuses anything else", () => {
		const png = readFileSync(join(repo, "assets", "screens", "chrome.png"));
		const size = pngSize(png);
		expect(size.width).toBeGreaterThan(size.height / 2);
		expect(size.height).toBeGreaterThan(0);
		expect(() => pngSize(new Uint8Array([1, 2, 3]))).toThrow("has to be a PNG");
		expect(() => pngSize(new TextEncoder().encode("not a png, just some bytes"))).toThrow("has to be a PNG");
	});
});

describe("what the page is told", () => {
	test("draws the palette the served pages use, and the pack's own version", () => {
		const palette = pagePalette();
		expect(palette.canvas).toBe(WEB_THEME_TOKENS.dark["--canvas"]);
		expect(palette.accent).toBe(WEB_THEME_TOKENS.dark["--accent"]);
		expect(palette.text).toBe(WEB_THEME_TOKENS.dark["--text"]);
		const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as { version: string };
		expect(packageVersion()).toBe(manifest.version);
		expect(request().brand.version).toBe(manifest.version);
	});

	test("is recorded as H.264, and handed every slide with its kicker", () => {
		const script = montageScript(request());
		expect(script).toContain("video/mp4;codecs=avc1");
		for (const slide of MONTAGE) {
			expect(script).toContain(`"frame":"${slide.frame}"`);
			expect(script).toContain(slide.kicker);
			expect(script).toContain(slide.caption);
		}
	});

	test("paints one still per slide a little past halfway, when asked for stills", () => {
		const times = stillTimes();
		expect(times.length).toBe(MONTAGE.length);
		const painted = request(parseArgs([]), times);
		expect(painted.stills?.length).toBe(MONTAGE.length);
		expect(montageScript(painted)).toContain('"stills":[');
		// Each still lands inside its own slide, not a fade and not the one after it.
		let start = 0;
		times.forEach((time, index) => {
			expect(time, MONTAGE[index].frame).toBeGreaterThan(start);
			expect(time, MONTAGE[index].frame).toBeLessThan(start + MONTAGE[index].seconds);
			start += MONTAGE[index].seconds;
		});
	});
});
