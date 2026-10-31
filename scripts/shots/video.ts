/**
 * Montage the shipped frames into the gallery preview video (dev tooling).
 *
 * `pi.video` in `package.json` names the file this writes: a short sequence of
 * pictures the package already ships, cross-faded, with one caption each. It is
 * the pi.dev gallery's preview, so it has to be reproducible — the same six
 * assets in, the same six slides out — and it has to be producible on a machine
 * with no encoder installed, which is why the encoder is the Chrome the other
 * captures already drive rather than ffmpeg: a canvas, `captureStream`, and
 * `MediaRecorder` with H.264 in mp4.
 *
 * The page half is an expression string, the way every capture here writes its
 * page code: `tsconfig` has no DOM lib, and the browser is not this program.
 *
 *   bun run screenshot:video [-o assets/video/demo.mp4] [--width 1280]
 *     [--height 720] [--fps 30] [--bps 1400000]
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { chromeBinary } from "../capture/chrome.ts";
import { runCli } from "../cli.ts";
import { repo } from "../theme.ts";

/** One slide: a frame the package ships, and the one line it is shown with. */
export interface MontageFrame {
	/** Asset stem under `assets/screens`, without `.png`. */
	frame: string;
	/** The only words in the video. */
	caption: string;
	/** How long the slide holds; the cross-fade into it is inside this time. */
	seconds: number;
	/** `contain` fits the whole frame; `pan` scrolls a tall one from top to bottom. */
	mode: "contain" | "pan";
}

/**
 * The storyboard, in order.
 *
 * It grows breadth-first: the whole window, then planning, the widgets, the
 * board page, the file browser, and the tool gallery. A frame that is wider than
 * it is tall is drawn whole; the gallery is 12466 pixels tall, so the last slide
 * pans it rather than shrinking it into a stamp.
 */
export const MONTAGE: readonly MontageFrame[] = [
	{ frame: "chrome", caption: "The turn, the tools, and the chrome", seconds: 2.4, mode: "contain" },
	{ frame: "plan", caption: "Plan first — approve before anything is written", seconds: 2.4, mode: "contain" },
	{ frame: "todo", caption: "Todos and a goal, kept in view", seconds: 1.6, mode: "contain" },
	{ frame: "plan-review", caption: "Review the plan in a browser, or as a teammate", seconds: 2.2, mode: "pan" },
	{ frame: "file-browse", caption: "Browse and preview inside the session", seconds: 2.0, mode: "pan" },
	{ frame: "tool-renderings", caption: "Every tool block, rendered", seconds: 2.0, mode: "pan" },
];

/** How long one slide takes to fade in over the one before it, in seconds. */
const FADE_SECONDS = 0.22;

/**
 * The furthest a `pan` slide travels, in card pixels.
 *
 * The tool gallery is 12466 pixels tall: scaled into the card it scrolls 8231 of
 * them, which at a slide's length is four thousand pixels a second and arrives
 * as encoder smear rather than as a picture. A card reveals a screenful and a
 * half instead, and the caption says what the list is.
 */
const MAX_PAN = 720;

/** The montage's own palette: the `bytefly-dark` canvas, text, and hairline. */
const COLORS = {
	canvas: "#0d1117",
	text: "#c9d1d9",
	muted: "#8b949e",
	border: "#30363d",
} as const;

const FONT = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";

/** What one run of the CLI was asked for. */
export interface VideoOptions {
	/** Absolute output path. */
	out: string;
	/** Canvas width in pixels. */
	width: number;
	/** Canvas height in pixels. */
	height: number;
	/** Captured frames per second. */
	fps: number;
	/** Target video bitrate; the montage is a preview, not a master. */
	bps: number;
}

const DEFAULTS: VideoOptions = {
	out: join(repo, "assets", "video", "demo.mp4"),
	width: 1280,
	height: 720,
	fps: 30,
	bps: 1_400_000,
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

/** The storyboard's length: the sum of its slides, fades included. */
export function totalSeconds(montage: readonly MontageFrame[] = MONTAGE): number {
	return montage.reduce((total, slide) => total + slide.seconds, 0);
}

/** One slide, with its picture inlined for the page that draws it. */
export interface Slide extends MontageFrame {
	/** A `data:` URL holding the frame's PNG. */
	src: string;
}

/** What the page is handed: the slides, the canvas, and the palette. */
export interface MontageRequest {
	slides: Slide[];
	width: number;
	height: number;
	fps: number;
	bps: number;
	fadeSeconds: number;
	totalSeconds: number;
	maxPan: number;
	colors: typeof COLORS;
	font: string;
}

/**
 * Read every frame the storyboard names.
 *
 * A missing asset fails with the command that captures it, because a montage
 * that silently drops a slide is a video asserting something the product does
 * not show.
 */
export function slides(montage: readonly MontageFrame[] = MONTAGE): Slide[] {
	return montage.map((slide) => {
		const path = join(repo, "assets", "screens", `${slide.frame}.png`);
		if (!existsSync(path))
			throw new Error(`${path} is missing; capture it with \`bun run screenshots ${slide.frame}\``);
		return { ...slide, src: `data:image/png;base64,${readFileSync(path).toString("base64")}` };
	});
}

/**
 * The page expression: draw the storyboard onto a canvas and record it.
 *
 * The clock is the storyboard's, not the frame count's: each paint samples the
 * elapsed time, so a slow machine drops frames instead of stretching the video,
 * and the file ends where the storyboard does. The caption band is reserved on
 * every slide, so a tall one pans inside the picture area and never over the
 * words. The bytes come back as base64 because the page has no filesystem.
 */
export function montageScript(request: MontageRequest): string {
	return `(async function () {
	const request = ${JSON.stringify(request)};
	const frames = request.slides;
	const canvas = document.createElement("canvas");
	canvas.width = request.width;
	canvas.height = request.height;
	canvas.style.display = "block";
	document.documentElement.style.overflow = "hidden";
	document.body.style.margin = "0";
	document.body.style.background = request.colors.canvas;
	document.body.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d context unavailable");
	const images = await Promise.all(frames.map(function (slide) {
		return new Promise(function (resolve, reject) {
			const image = new Image();
			image.onload = function () { resolve(image); };
			image.onerror = function () { reject(new Error("could not decode " + slide.frame)); };
			image.src = slide.src;
		});
	}));
	const MARGIN = 64;
	const TOP = 40;
	const CAPTION_BAND = 76;
	const GAP = 24;
	const box = { x: MARGIN, y: TOP, w: request.width - MARGIN * 2, h: request.height - TOP - CAPTION_BAND - GAP };
	const captionY = request.height - 36;
	const ease = function (t) { return t * t * (3 - 2 * t); };
	const clamp01 = function (value) { return Math.min(1, Math.max(0, value)); };
	// The card hugs the picture it holds, so a wide frame is not floated in a box of
	// another shape's making; the panning gallery is the exception, because its card
	// is the window it scrolls behind.
	const place = function (index, progress) {
		const slide = frames[index];
		const image = images[index];
		const scale =
			slide.mode === "pan" ? box.w / image.width : Math.min(box.w / image.width, box.h / image.height);
		const w = image.width * scale;
		const h = image.height * scale;
		if (slide.mode === "pan") {
			const travel = Math.min(Math.max(0, h - box.h), request.maxPan);
			return {
				card: { x: box.x, y: box.y, w: box.w, h: box.h },
				image: { x: box.x, y: box.y - travel * ease(clamp01(progress)), w: w, h: h },
			};
		}
		const card = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h), w: w, h: h };
		return { card: card, image: card };
	};
	const paintImage = function (index, progress, alpha) {
		const at = place(index, progress);
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.beginPath();
		ctx.roundRect(at.card.x, at.card.y, at.card.w, at.card.h, 10);
		ctx.clip();
		ctx.drawImage(images[index], 0, 0, images[index].width, images[index].height, at.image.x, at.image.y, at.image.w, at.image.h);
		ctx.restore();
	};
	const paintBorder = function (index, progress) {
		const at = place(index, progress);
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(at.card.x + 0.5, at.card.y + 0.5, at.card.w - 1, at.card.h - 1, 10);
		ctx.strokeStyle = request.colors.border;
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();
	};
	const paintCaption = function (index) {
		ctx.save();
		ctx.fillStyle = request.colors.text;
		ctx.font = "500 22px " + request.font;
		ctx.textAlign = "left";
		ctx.fillText(frames[index].caption, box.x + 4, captionY);
		ctx.fillStyle = request.colors.muted;
		ctx.font = "500 15px " + request.font;
		ctx.textAlign = "right";
		ctx.fillText("my-pi-agent", request.width - MARGIN, captionY);
		ctx.restore();
	};
	const starts = [];
	let at = 0;
	for (const slide of frames) {
		starts.push(at);
		at += slide.seconds;
	}
	const paintAt = function (time) {
		const index = Math.max(0, starts.findLastIndex(function (start) { return start <= time; }));
		const start = starts[index];
		const fadeIn = index === 0 ? 1 : clamp01((time - start) / request.fadeSeconds);
		ctx.fillStyle = request.colors.canvas;
		ctx.fillRect(0, 0, request.width, request.height);
		// The pictures cross-fade, the words do not: two captions at half strength
		// read as neither, so the caption swaps at the midpoint of the fade.
		if (fadeIn < 1) paintImage(index - 1, 1, 1 - fadeIn);
		paintImage(index, (time - start) / frames[index].seconds, fadeIn);
		paintBorder(index, (time - start) / frames[index].seconds);
		paintCaption(fadeIn < 0.5 ? index - 1 : index);
	};
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
	// The last painted frame has to reach the encoder before stop, or the video
	// ends one frame short of the storyboard.
	await new Promise(function (resolve) { setTimeout(resolve, 250); });
	recorder.stop();
	await stopped;
	const bytes = new Uint8Array(await new Blob(chunks, { type: "video/mp4" }).arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
})()`;
}

/** The page's whole input: the slides plus every constant the drawing needs. */
export function montageRequest(slides: readonly Slide[], options: VideoOptions): MontageRequest {
	return {
		slides: [...slides],
		width: options.width,
		height: options.height,
		fps: options.fps,
		bps: options.bps,
		fadeSeconds: FADE_SECONDS,
		totalSeconds: totalSeconds(slides),
		maxPan: MAX_PAN,
		colors: COLORS,
		font: FONT,
	};
}

/** Render the montage and return the encoded bytes. */
export async function renderMontage(
	options: VideoOptions,
	montage: readonly MontageFrame[] = MONTAGE,
): Promise<Uint8Array> {
	const request = montageRequest(slides(montage), options);
	const browser = await chromium.launch({ executablePath: chromeBinary(), headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: options.width, height: options.height } });
		await page.setContent("<!doctype html><title>montage</title><body></body>");
		const encoded = await page.evaluate<unknown>(montageScript(request));
		if (typeof encoded !== "string" || encoded.length === 0) throw new Error("the page recorded no video");
		return new Uint8Array(Buffer.from(encoded, "base64"));
	} finally {
		await browser.close();
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const bytes = await renderMontage(options);
	mkdirSync(dirname(options.out), { recursive: true });
	await Bun.write(options.out, bytes);
	const megabytes = (bytes.byteLength / 1_048_576).toFixed(1);
	console.log(
		`montage ${MONTAGE.length} frames, ${totalSeconds().toFixed(1)}s → ${options.out} (${megabytes} MB, video/mp4;codecs=avc1)`,
	);
}

runCli("usage: bun run scripts/shots/video.ts [-o <file.mp4>] [--width n] [--height n] [--fps n] [--bps n]", main);
