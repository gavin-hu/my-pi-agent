/**
 * What the gallery preview shows, and where each picture sits (dev tooling).
 *
 * `pi.video` names a tour of the surfaces the package ships. This module is the
 * storyboard — which frame, which words, how long — and the geometry that turns a
 * picture's size into a place inside the one stage every slide is drawn in, so the page
 * that paints it (`video.ts`) is handed numbers instead of making its own decisions, and
 * a test can read both without opening a browser.
 *
 * Nothing here encodes or launches anything: it reads PNG headers, the pack's version,
 * and the palette the served pages already draw with.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_THEME_TOKENS } from "../../lib/web/tokens.ts";
import { repo } from "../theme.ts";

/** One slide: a frame the package ships, the words it is shown with, and its length. */
export interface MontageFrame {
	/** Asset stem under `assets/screens`, without `.png`. */
	frame: string;
	/** The scope the slide belongs to, drawn in mono above the caption. */
	kicker: string;
	/** The one sentence the slide is shown with. */
	caption: string;
	/** How long the slide holds; the cross-fade into it is inside this time. */
	seconds: number;
	/**
	 * A frame taller than the stage fills its width and scrolls down instead of being
	 * shrunk to fit, which is the only way a 12 466px gallery reads as a picture.
	 */
	scroll?: boolean;
}

/**
 * The storyboard, in order.
 *
 * It follows one turn of work and then the surfaces around it: the session, the plan,
 * approving it, the checklist, the check, the board and its teammates, the worktree the
 * work sat in, the files, and finally every tool block the pack can draw. The browser
 * page and the terminal screen for the plan both appear because they are how the same
 * feature is met from two places, and no caption claims otherwise.
 */
export const MONTAGE: readonly MontageFrame[] = [
	{ frame: "chrome", kicker: "session", caption: "One turn: the tools, the rails, the cost", seconds: 3.0 },
	{ frame: "plan", kicker: "plan", caption: "Nothing is written until you approve the plan", seconds: 3.0 },
	{
		frame: "plan-review",
		kicker: "plan · browser",
		caption: "Approve it in the browser, or from a shared link",
		seconds: 3.2,
		scroll: true,
	},
	{ frame: "todo", kicker: "todo", caption: "A goal and a checklist, kept in view", seconds: 2.2 },
	{ frame: "check", kicker: "check", caption: "Run the check and read the one failure", seconds: 2.6 },
	{ frame: "board", kicker: "board", caption: "Cards move from plan to execute to done", seconds: 3.2 },
	{ frame: "team", kicker: "board · team", caption: "Teammates plan and execute side by side", seconds: 2.8 },
	{ frame: "worktree", kicker: "worktree", caption: "Every task in its own worktree", seconds: 2.6 },
	{
		frame: "file-browse",
		kicker: "file-browse",
		caption: "Read and preview files in place",
		seconds: 3.0,
		scroll: true,
	},
	{
		frame: "tool-renderings",
		kicker: "tools",
		caption: "Every tool block, rendered by its own tool",
		seconds: 3.4,
		scroll: true,
	},
];

/**
 * The command that captures each page frame, and with it the list of frames that came
 * from a page rather than a terminal window: a page has no title bar, so nothing is
 * trimmed from its top, and a missing one names the shot that makes it.
 */
const PAGE_CAPTURE: Record<string, string> = {
	board: "bun run screenshot:board --theme dark",
	team: "bun run screenshot:board --theme dark",
	"card-dialog": "bun run screenshot:board --theme dark --dialog card",
	"plan-review": "bun run screenshot:plan <plan.md>",
	"file-browse": "bun run screenshot:file-browse",
	"tool-renderings": "bun run screenshot:tools",
};

/** The frames captured from a page, whose top edge is the page's own. */
export const PAGE_FRAMES: ReadonlySet<string> = new Set(Object.keys(PAGE_CAPTURE));

/**
 * How much of a terminal frame's top edge a slide drops, in pixels.
 *
 * The terminal captures crop the title bar by 28 points and leave about seven pixels of
 * its light bottom edge behind, which reads as a bright seam once the picture is scaled
 * into the stage. The seam belongs to `capture/terminal.ts`, not to the montage; until
 * the crop grows, the picture starts below it.
 */
const TERMINAL_TRIM = 8;

/** The furthest a scrolling slide travels, in multiples of the stage's height. */
const PAN_STAGES = 1.25;

/** The design's measurements in pixels at 720p; another height scales them together. */
const REFERENCE = {
	height: 720,
	margin: 56,
	brandRow: 64,
	captionBand: 108,
	inset: 14,
	brandBaseline: 40,
	// The track sits between the stage and the words: it closes the picture and opens
	// the caption, rather than trailing under it as decoration at the frame's edge.
	progressAbove: 92,
	kickerAbove: 60,
	captionAbove: 26,
	stageRadius: 14,
	pictureRadius: 6,
	progressHeight: 3,
	brandFont: 16,
	chipFont: 12,
	kickerFont: 12,
	captionFont: 24,
} as const;

/** A rectangle on the canvas, in pixels. */
export interface Stage {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A picture's pixel size, read from its PNG header. */
export interface FrameSize {
	width: number;
	height: number;
}

/** Where a picture sits inside its stage, and how far it travels while its slide holds. */
export interface FrameLayout {
	/** Drawn size, after scaling. */
	width: number;
	height: number;
	/** Top-left corner at the start of the slide. */
	x: number;
	y: number;
	/** How far the picture scrolls up over the slide, in canvas pixels. */
	travel: number;
}

/** The furniture around the picture: brand row, stage, caption band, progress track. */
export interface Chrome {
	/** The margin the stage and the words share. */
	margin: number;
	/** The fixed card every picture is drawn inside. */
	stage: Stage;
	/** The inset box inside the stage a picture is fitted to. */
	picture: Stage;
	inset: number;
	radius: number;
	pictureRadius: number;
	progressHeight: number;
	brandBaseline: number;
	kickerBaseline: number;
	captionBaseline: number;
	progressY: number;
	fonts: { brand: number; chip: number; kicker: number; caption: number };
}

/** The `lib/web` roles the montage draws with, so the preview cannot drift from a page. */
export interface Palette {
	canvas: string;
	surface: string;
	line: string;
	lineStrong: string;
	text: string;
	muted: string;
	dim: string;
	accent: string;
}

/** What the top row says, left to right. */
export interface Brand {
	name: string;
	handle: string;
	version: string;
}

/** The storyboard's length: the sum of its slides, fades included. */
export function totalSeconds(montage: readonly MontageFrame[] = MONTAGE): number {
	return montage.reduce((total, slide) => total + slide.seconds, 0);
}

/** When a stills run paints each slide: a little past halfway through its hold. */
export function stillTimes(montage: readonly MontageFrame[] = MONTAGE): number[] {
	const times: number[] = [];
	let at = 0;
	for (const slide of montage) {
		times.push(at + slide.seconds * 0.55);
		at += slide.seconds;
	}
	return times;
}

/** The furniture for a canvas: the same design at any height. */
export function chromeFor(size: { width: number; height: number }): Chrome {
	const scale = size.height / REFERENCE.height;
	const px = (value: number): number => Math.round(value * scale);
	const margin = px(REFERENCE.margin);
	const inset = px(REFERENCE.inset);
	const stage: Stage = {
		x: margin,
		y: px(REFERENCE.brandRow),
		w: size.width - margin * 2,
		h: size.height - px(REFERENCE.brandRow) - px(REFERENCE.captionBand),
	};
	return {
		margin,
		stage,
		picture: { x: stage.x + inset, y: stage.y + inset, w: stage.w - inset * 2, h: stage.h - inset * 2 },
		inset,
		radius: px(REFERENCE.stageRadius),
		pictureRadius: px(REFERENCE.pictureRadius),
		progressHeight: Math.max(2, px(REFERENCE.progressHeight)),
		brandBaseline: px(REFERENCE.brandBaseline),
		kickerBaseline: size.height - px(REFERENCE.kickerAbove),
		captionBaseline: size.height - px(REFERENCE.captionAbove),
		progressY: size.height - px(REFERENCE.progressAbove),
		fonts: {
			brand: px(REFERENCE.brandFont),
			chip: px(REFERENCE.chipFont),
			kicker: px(REFERENCE.kickerFont),
			caption: px(REFERENCE.captionFont),
		},
	};
}

/**
 * Where one picture sits in its box.
 *
 * A slide that scrolls fills the box's width and travels up by its overflow, capped so
 * the gallery reveals a screen and a half rather than four thousand pixels a second of
 * encoder smear. Everything else is fitted whole and centred, because a whole window is
 * what the reader is being shown.
 */
export function layout(size: FrameSize, box: Stage, options: { trim: number; scroll: boolean }): FrameLayout {
	const visible = size.height - options.trim;
	const scale = options.scroll ? box.w / size.width : Math.min(box.w / size.width, box.h / visible);
	const width = size.width * scale;
	const height = visible * scale;
	return {
		width,
		height,
		x: box.x + (box.w - width) / 2,
		y: box.y + Math.max(0, box.h - height) / 2,
		travel: options.scroll ? Math.min(Math.max(0, height - box.h), PAN_STAGES * box.h) : 0,
	};
}

/** A PNG's pixel size, read from its IHDR; refuses anything that is not a PNG. */
export function pngSize(bytes: Uint8Array): FrameSize {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.byteLength < 24 || signature.some((byte, at) => bytes[at] !== byte))
		throw new Error("a montage frame has to be a PNG");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The pack version the brand row prints, read so a bump cannot leave it saying the old one. */
export function packageVersion(): string {
	const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf-8")) as { version?: unknown };
	if (typeof manifest.version !== "string") throw new Error("package.json has no version");
	return manifest.version;
}

/** The palette, resolved from the tokens the served pages already draw with. */
export function pagePalette(): Palette {
	const dark = WEB_THEME_TOKENS.dark;
	const need = (token: string): string => {
		const value = dark[token];
		if (value === undefined) throw new Error(`lib/web/tokens.ts has no ${token}`);
		return value;
	};
	return {
		canvas: need("--canvas"),
		surface: need("--surface"),
		line: need("--border"),
		lineStrong: need("--border-strong"),
		text: need("--text"),
		muted: need("--muted"),
		dim: need("--dim"),
		accent: need("--accent"),
	};
}

/** One slide, with its picture inlined for the page that draws it. */
export interface Slide extends MontageFrame {
	/** A `data:` URL holding the frame's PNG. */
	src: string;
	/** The PNG's pixel size. */
	width: number;
	height: number;
	/** Pixels dropped from its top: the terminal title bar's residue, else 0. */
	trim: number;
}

/**
 * Read every frame the storyboard names.
 *
 * A missing asset fails with the command that captures it, because a montage that
 * silently drops a slide is a video asserting something the product does not show.
 */
export function slides(montage: readonly MontageFrame[] = MONTAGE): Slide[] {
	return montage.map((slide) => {
		const path = join(repo, "assets", "screens", `${slide.frame}.png`);
		if (!existsSync(path))
			throw new Error(
				`${path} is missing; capture it with \`${PAGE_CAPTURE[slide.frame] ?? `bun run screenshots ${slide.frame}`}\``,
			);
		const bytes = readFileSync(path);
		return {
			...slide,
			src: `data:image/png;base64,${bytes.toString("base64")}`,
			...pngSize(bytes),
			trim: PAGE_FRAMES.has(slide.frame) ? 0 : TERMINAL_TRIM,
		};
	});
}
