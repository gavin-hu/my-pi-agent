/**
 * Encode the gallery preview video from the montage storyboard (dev tooling).
 *
 * `pi.video` in `package.json` names the file this writes. The page half is an expression
 * string, the way every capture here writes its page code: `tsconfig` has no DOM lib, and
 * the browser is not this program. It is handed the storyboard the geometry already
 * resolved (`montage.ts`) and draws it — the brand row, the fixed stage, the cross-faded
 * pictures, the kicker and caption, the chaptered progress bar — and then records the
 * canvas as H.264 with the Chrome the other captures already drive, because a machine
 * with no encoder installed still has to be able to reproduce this file.
 *
 *   bun run screenshot:video [-o assets/video/demo.mp4] [--stills <dir>] [--width 1280]
 *     [--height 720] [--fps 30] [--bps 1000000]
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { chromeBinary } from "../capture/chrome.ts";
import { runCli } from "../cli.ts";
import { repo } from "../theme.ts";
import {
	type Brand,
	type Chrome,
	type FrameLayout,
	MONTAGE,
	type MontageFrame,
	type Palette,
	type Slide,
	chromeFor,
	layout,
	packageVersion,
	pagePalette,
	slides,
	stillTimes,
	totalSeconds,
} from "./montage.ts";

/** How long one slide takes to fade in over the one before it, in seconds. */
const FADE_SECONDS = 0.26;

/** How long the words take to rise into place once they hand over, in seconds. */
const CAPTION_SECONDS = 0.22;

/**
 * When the words hand over, as a fraction of the cross-fade.
 *
 * The outgoing line holds at full strength until the incoming picture is nearly opaque,
 * and then the incoming line arrives already lit — two captions at half strength read as
 * neither, and a swap through nothing leaves the frame wordless for a tenth of a second.
 */
const WORD_HANDOVER = 0.6;

/** The two stacks the page draws with: the terminal's UI font and its mono. */
const FONT = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
const FONT_MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

/** What one run of the CLI was asked for. */
export interface VideoOptions {
	/** Absolute output path. */
	out: string;
	/** Absolute directory a `--stills` run writes one PNG per slide into. */
	stills?: string;
	/** Canvas width in pixels. */
	width: number;
	/** Canvas height in pixels. */
	height: number;
	/** Captured frames per second. */
	fps: number;
	/**
	 * Target video bitrate. The gallery autoplays the file, so this is a budget rather
	 * than a quality knob: the storyboard's length times this must stay small.
	 */
	bps: number;
}

const DEFAULTS: VideoOptions = {
	out: join(repo, "assets", "video", "demo.mp4"),
	width: 1280,
	height: 720,
	fps: 30,
	bps: 1_000_000,
};

/** The numeric flags, mapped to the option each one sets. */
const NUMERIC = {
	"--width": "width",
	"--height": "height",
	"--fps": "fps",
	"--bps": "bps",
} as const;

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): VideoOptions {
	const options: VideoOptions = { ...DEFAULTS };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			return next;
		};
		if (arg === "-o" || arg === "--out") options.out = resolve(value());
		else if (arg === "--stills") options.stills = resolve(value());
		else if (arg === "-h" || arg === "--help") throw new Error("");
		else if (arg in NUMERIC) {
			const key = NUMERIC[arg as keyof typeof NUMERIC];
			const parsed = Number(value());
			if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${arg} must be positive`);
			options[key] = Math.round(parsed);
		} else throw new Error(`unknown option ${arg}`);
	}
	if (options.width < 320 || options.height < 240) throw new Error("the canvas must be at least 320×240");
	if (options.fps < 1 || options.fps > 60) throw new Error("--fps must be between 1 and 60");
	return options;
}

/** A slide as the page draws it: the picture, and where it sits. */
export interface PaintedSlide extends Slide {
	layout: FrameLayout;
}

/** What the page is handed: the slides, the furniture, the palette, and the clock. */
export interface MontageRequest {
	frames: PaintedSlide[];
	width: number;
	height: number;
	fps: number;
	bps: number;
	fadeSeconds: number;
	captionSeconds: number;
	wordHandover: number;
	totalSeconds: number;
	chrome: Chrome;
	palette: Palette;
	brand: Brand;
	font: string;
	fontMono: string;
	/** The times a stills run paints; absent when the page records a video. */
	stills?: number[];
}

/** The page's whole input: the slides, their geometry, and every constant the drawing needs. */
export function montageRequest(frames: readonly Slide[], options: VideoOptions, stills?: number[]): MontageRequest {
	const chrome = chromeFor(options);
	return {
		frames: frames.map((frame) => ({
			...frame,
			layout: layout(frame, chrome.picture, { trim: frame.trim, scroll: frame.scroll === true }),
		})),
		width: options.width,
		height: options.height,
		fps: options.fps,
		bps: options.bps,
		fadeSeconds: FADE_SECONDS,
		captionSeconds: CAPTION_SECONDS,
		wordHandover: WORD_HANDOVER,
		totalSeconds: totalSeconds(frames),
		chrome,
		palette: pagePalette(),
		brand: { name: "my-pi-agent", handle: "gavin-hu/my-pi-agent", version: packageVersion() },
		font: FONT,
		fontMono: FONT_MONO,
		...(stills === undefined ? {} : { stills }),
	};
}

/**
 * The page expression: draw the storyboard onto a canvas and record it.
 *
 * The clock is the storyboard's, not the frame count's: each paint samples the elapsed
 * time, so a slow machine drops frames instead of stretching the video, and the file ends
 * where the storyboard does. The bytes come back as base64 because the page has no
 * filesystem.
 */
export function montageScript(request: MontageRequest): string {
	return `(async function () {
	const request = ${JSON.stringify(request)};
	const frames = request.frames;
	const chrome = request.chrome;
	const palette = request.palette;
	const font = request.font;
	const mono = request.fontMono;
	const canvas = document.createElement("canvas");
	canvas.width = request.width;
	canvas.height = request.height;
	canvas.style.display = "block";
	document.documentElement.style.overflow = "hidden";
	document.body.style.margin = "0";
	document.body.style.background = palette.canvas;
	document.body.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d context unavailable");
	const images = await Promise.all(frames.map(function (frame) {
		return new Promise(function (resolve, reject) {
			const image = new Image();
			image.onload = function () { resolve(image); };
			image.onerror = function () { reject(new Error("could not decode " + frame.frame)); };
			image.src = frame.src;
		});
	}));
	const clamp01 = function (value) { return Math.min(1, Math.max(0, value)); };
	const ease = function (t) { return t * t * (3 - 2 * t); };
	const out = function (t) { return 1 - Math.pow(1 - t, 3); };
	const starts = [];
	let at = 0;
	for (const frame of frames) { starts.push(at); at += frame.seconds; }

	const roundRect = function (x, y, w, h, radius) {
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, radius);
	};

	// The canvas is the theme's, with one wash of accent behind the stage: a flat void
	// reads as a slideshow, and every served page and poster is lit the same way.
	const paintBackground = function () {
		ctx.fillStyle = palette.canvas;
		ctx.fillRect(0, 0, request.width, request.height);
		ctx.save();
		ctx.globalAlpha = 0.11;
		const glow = ctx.createRadialGradient(
			request.width * 0.06, chrome.stage.y, 0,
			request.width * 0.06, chrome.stage.y, Math.max(request.width, request.height) * 0.7,
		);
		glow.addColorStop(0, palette.accent);
		glow.addColorStop(1, palette.canvas);
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, request.width, request.height);
		ctx.restore();
	};

	const paintStage = function () {
		ctx.save();
		roundRect(chrome.stage.x, chrome.stage.y, chrome.stage.w, chrome.stage.h, chrome.radius);
		ctx.fillStyle = palette.surface;
		ctx.fill();
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = palette.lineStrong;
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();
	};

	const paintBrand = function () {
		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		ctx.font = "650 " + chrome.fonts.brand + "px " + font;
		ctx.fillStyle = palette.text;
		ctx.fillText(request.brand.name, chrome.margin, chrome.brandBaseline);
		const chipX = chrome.margin + ctx.measureText(request.brand.name).width + chrome.fonts.brand * 0.6;
		const label = "v" + request.brand.version;
		ctx.font = "500 " + chrome.fonts.chip + "px " + mono;
		const chipH = chrome.fonts.chip + 10;
		const chipW = ctx.measureText(label).width + chrome.fonts.chip;
		roundRect(chipX, chrome.brandBaseline - chipH + 4, chipW, chipH, chipH / 2);
		ctx.fillStyle = palette.surface;
		ctx.fill();
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = palette.lineStrong;
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillStyle = palette.muted;
		ctx.fillText(label, chipX + chrome.fonts.chip / 2, chrome.brandBaseline);
		ctx.textAlign = "right";
		ctx.fillStyle = palette.dim;
		ctx.fillText(request.brand.handle, request.width - chrome.margin, chrome.brandBaseline);
		ctx.restore();
	};

	const paintPicture = function (index, progress, alpha, settle) {
		const frame = frames[index];
		const place = frame.layout;
		const zoom = 1 - settle * 0.015;
		const w = place.width * zoom;
		const h = place.height * zoom;
		const x = place.x + (place.width - w) / 2;
		const y = place.y + (place.height - h) / 2 - place.travel * ease(clamp01((progress - 0.12) / 0.76));
		ctx.save();
		ctx.globalAlpha = alpha;
		roundRect(chrome.picture.x, chrome.picture.y, chrome.picture.w, chrome.picture.h, chrome.pictureRadius);
		ctx.clip();
		ctx.drawImage(images[index], 0, frame.trim, frame.width, frame.height - frame.trim, x, y, w, h);
		ctx.restore();
	};

	const paintWords = function (index, alpha, rise) {
		const frame = frames[index];
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.textAlign = "left";
		ctx.textBaseline = "alphabetic";
		const dot = chrome.fonts.kicker / 4;
		ctx.beginPath();
		ctx.arc(chrome.margin + dot, chrome.kickerBaseline - chrome.fonts.kicker / 3 + rise, dot, 0, Math.PI * 2);
		ctx.fillStyle = palette.accent;
		ctx.fill();
		ctx.font = "500 " + chrome.fonts.kicker + "px " + mono;
		if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0.08em";
		ctx.fillStyle = palette.accent;
		ctx.fillText(frame.kicker, chrome.margin + chrome.fonts.kicker * 1.4, chrome.kickerBaseline + rise);
		if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";
		ctx.font = "600 " + chrome.fonts.caption + "px " + font;
		ctx.fillStyle = palette.text;
		ctx.fillText(frame.caption, chrome.margin, chrome.captionBaseline + rise);
		ctx.restore();
	};

	// One segment per slide, by the time it holds, so the bar says both how long this
	// video is and where in it the reader is.
	const paintProgress = function (time) {
		const gap = 2;
		const span = chrome.stage.w - gap * Math.max(0, frames.length - 1);
		let x = chrome.stage.x;
		frames.forEach(function (frame, index) {
			const w = span * frame.seconds / request.totalSeconds;
			const played = clamp01((time - starts[index]) / frame.seconds);
			ctx.save();
			ctx.globalAlpha = 0.45;
			roundRect(x, chrome.progressY, w, chrome.progressHeight, chrome.progressHeight / 2);
			ctx.fillStyle = palette.line;
			ctx.fill();
			if (played > 0) {
				ctx.globalAlpha = 1;
				roundRect(x, chrome.progressY, Math.max(w * played, chrome.progressHeight), chrome.progressHeight, chrome.progressHeight / 2);
				ctx.fillStyle = palette.accent;
				ctx.fill();
			}
			ctx.restore();
			x += w + gap;
		});
	};

	// Which slide's words are showing: the outgoing line holds until the picture has all
	// but arrived, then the incoming one rises into place.
	const words = function (index, time) {
		if (index === 0) return { index: index, alpha: 1, rise: 0 };
		const phase = (time - starts[index] - request.fadeSeconds * request.wordHandover) / request.captionSeconds;
		if (phase < 0) return { index: index - 1, alpha: 1, rise: 0 };
		const entering = clamp01(phase);
		return { index: index, alpha: 0.45 + 0.55 * entering, rise: 5 * (1 - entering) };
	};

	const paintAt = function (time) {
		const index = Math.max(0, starts.findLastIndex(function (start) { return start <= time; }));
		const since = time - starts[index];
		const fade = index === 0 ? 1 : out(clamp01(since / request.fadeSeconds));
		paintBackground();
		paintBrand();
		paintStage();
		if (fade < 1) paintPicture(index - 1, 1, 1 - fade, 0);
		paintPicture(index, since / frames[index].seconds, fade, 1 - fade);
		const caption = words(index, time);
		if (caption.alpha > 0) paintWords(caption.index, caption.alpha, caption.rise);
		paintProgress(time);
	};

	if (request.stills) {
		return request.stills.map(function (time) {
			paintAt(time);
			return canvas.toDataURL("image/png");
		});
	}

	const stream = canvas.captureStream(request.fps);
	const recorder = new MediaRecorder(stream, {
		mimeType: "video/mp4;codecs=avc1",
		videoBitsPerSecond: request.bps,
	});
	const chunks = [];
	recorder.ondataavailable = function (event) {
		if (event.data.size > 0) chunks.push(event.data);
	};
	const stopped = new Promise(function (resolve) { recorder.onstop = function () { resolve(); }; });
	recorder.start();
	const started = performance.now();
	await new Promise(function (resolve) {
		const tick = function () {
			const time = Math.min((performance.now() - started) / 1000, request.totalSeconds);
			paintAt(time);
			if (time >= request.totalSeconds) {
				clearInterval(timer);
				resolve();
			}
		};
		const timer = setInterval(tick, 1000 / request.fps);
		tick();
	});
	// The last painted frame has to reach the encoder before stop, or the video ends one
	// frame short of the storyboard.
	await new Promise(function (resolve) { setTimeout(resolve, 250); });
	recorder.stop();
	await stopped;
	const bytes = new Uint8Array(await new Blob(chunks, { type: "video/mp4" }).arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
})()`;
}

/** Run one page over the storyboard with Chrome open, and hand back what it produced. */
async function drive<T>(request: MontageRequest, read: (value: unknown) => T): Promise<T> {
	const browser = await chromium.launch({ executablePath: chromeBinary(), headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: request.width, height: request.height } });
		await page.setContent("<!doctype html><title>montage</title><body></body>");
		return read(await page.evaluate<unknown>(montageScript(request)));
	} finally {
		await browser.close();
	}
}

/** Render the montage and return the encoded bytes. */
export async function renderMontage(
	options: VideoOptions,
	montage: readonly MontageFrame[] = MONTAGE,
): Promise<Uint8Array> {
	return drive(montageRequest(slides(montage), options), (encoded) => {
		if (typeof encoded !== "string" || encoded.length === 0) throw new Error("the page recorded no video");
		return new Uint8Array(Buffer.from(encoded, "base64"));
	});
}

/** Render one still per slide, so a redesign can be reviewed as pictures. */
export async function renderStills(
	options: VideoOptions,
	montage: readonly MontageFrame[] = MONTAGE,
): Promise<Array<{ name: string; png: Uint8Array }>> {
	const frames = slides(montage);
	const times = stillTimes(montage);
	const drawn = await drive(montageRequest(frames, options, times), (value) => {
		const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
		if (list.length !== times.length) throw new Error(`the page drew ${list.length} of ${times.length} stills`);
		return list;
	});
	return frames.map((frame, index) => ({
		name: `${String(index + 1).padStart(2, "0")}-${frame.frame}.png`,
		png: new Uint8Array(Buffer.from(drawn[index].slice("data:image/png;base64,".length), "base64")),
	}));
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.stills !== undefined) {
		const stills = await renderStills(options);
		mkdirSync(options.stills, { recursive: true });
		for (const still of stills) await Bun.write(join(options.stills, still.name), still.png);
		console.log(`stills ${stills.length} → ${options.stills}`);
		return;
	}
	const bytes = await renderMontage(options);
	mkdirSync(dirname(options.out), { recursive: true });
	await Bun.write(options.out, bytes);
	const megabytes = (bytes.byteLength / 1_048_576).toFixed(1);
	console.log(
		`montage ${MONTAGE.length} frames, ${totalSeconds().toFixed(1)}s → ${options.out} (${megabytes} MB, video/mp4;codecs=avc1)`,
	);
}

runCli(
	"usage: bun run scripts/shots/video.ts [-o <file.mp4>] [--stills <dir>] [--width n] [--height n] [--fps n] [--bps n]",
	main,
);
