/**
 * Full-page PNG capture with headless Chrome (dev tooling).
 *
 * Shared by `shots/plan-review.ts`, `shots/file-browse.ts`, and
 * `tools/index.ts`: it drives the Chrome or Chromium this machine already
 * has through Playwright and captures the whole document — beyond the viewport —
 * in one shot, so a page taller than the window (a plan, a gallery of tool
 * blocks) is not clipped; a caller that names a `clip` gets that element's own
 * box instead, which is what a fixed-size poster wants. The binary is still found the way it always was,
 * `PI_CHROME` first and then the usual macOS bundles, so no capture downloads a
 * browser of its own.
 *
 * Value-only apart from the launch itself: the caller supplies the URL, the
 * expressions to evaluate before the capture, and the output path.
 */

import { existsSync } from "node:fs";
import { type Page, chromium } from "playwright-core";

/** Where Chrome usually lives, plus the `PI_CHROME` override. */
const CHROME_CANDIDATES = [
	process.env.PI_CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
].filter((path): path is string => Boolean(path));

/** The Chrome (or Chromium) binary to drive. */
export function chromeBinary(): string {
	for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
	throw new Error("Chrome not found; set PI_CHROME to a Chrome or Chromium binary.");
}

/** One expression evaluated in the page before the capture. A promise is awaited. */
export interface ChromeShotStep {
	/** JavaScript evaluated in the page. */
	expression: string;
}

/** A full-page capture request. */
export interface ChromeShotOptions {
	/** The URL Chrome opens. */
	url: string;
	/** Prefix the page target's URL must match, so a stray tab is ignored. */
	origin: string;
	/** Output PNG path. */
	out: string;
	/** CSS viewport width. */
	width: number;
	/** Device pixel ratio for a crisp capture. Default 2. */
	scale?: number;
	/** Scripts installed before the first navigation, for a page that starts with state. */
	init?: string[];
	/** Expressions run in order before the capture. */
	before?: ChromeShotStep[];
	/**
	 * Capture this element's own box instead of the document. A poster is one fixed
	 * box centred in whatever viewport it opens in, so its height is the element's,
	 * not the page's — measuring the document would carry the empty margin around
	 * it into the image.
	 */
	clip?: string;
}

/** The rows the capture opens with; the document's own height decides the image. */
const VIEWPORT_HEIGHT = 900;

/** How long the page gets to reach the requested document and report itself ready. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * Evaluate in the page, retrying while the document is replaced. Playwright
 * opens the tab before the first document commits, so an immediate evaluate can
 * land in a context that is about to be thrown away; a page expression that
 * throws still fails the capture, because a broken step would produce an image
 * of the wrong thing.
 */
async function evaluateInPage(page: Page, expression: string): Promise<unknown> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			return await page.evaluate(expression);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/context was destroyed|Execution context|navigat/i.test(message)) throw error;
			await page.waitForTimeout(100);
		}
	}
	throw new Error("Chrome kept replacing the page context.");
}

/**
 * A page-side promise that resolves `true` once `condition` holds and `false` at
 * the timeout. It polls at 50 ms, and resolving rather than rejecting means a
 * slow page still photographs instead of failing the capture; `condition` is an
 * expression, so a check needing a local can be an IIFE.
 *
 * Every capture waits this way: the requested document has loaded, the article
 * and its filter are drawn, the review page has its blocks and its state chip.
 */
export function readyWhen(condition: string, timeoutMs: number): string {
	return `new Promise(function (resolve) {
	var done = function () {
		return ${condition};
	};
	if (done()) { resolve(true); return; }
	var timer = setInterval(function () { if (done()) { clearInterval(timer); resolve(true); } }, 50);
	setTimeout(function () { clearInterval(timer); resolve(false); }, ${timeoutMs});
})`;
}

/**
 * Capture `options.url` as one full-page PNG, at the requested device scale.
 *
 * The document is awaited at its own origin rather than at the tab
 * Playwright opens first: `about:blank` is a real page, so a `before` step run
 * there would silently do nothing and the shot would show an empty shell.
 */
export async function captureFullPage(options: ChromeShotOptions): Promise<void> {
	const browser = await chromium.launch({
		executablePath: chromeBinary(),
		headless: true,
		args: ["--hide-scrollbars", "--force-prefers-reduced-motion"],
	});
	try {
		const page = await browser.newPage({
			viewport: { width: options.width, height: VIEWPORT_HEIGHT },
			deviceScaleFactor: options.scale ?? 2,
			reducedMotion: "reduce",
		});
		// Before the first navigation: a capture that starts from restored state needs
		// its storage in place before the page's own scripts run.
		for (const script of options.init ?? []) await page.addInitScript({ content: script });
		await page.goto(options.url, { waitUntil: "load" });
		await page.waitForFunction(
			`location.href.indexOf(${JSON.stringify(options.origin)}) === 0 && document.readyState === "complete"`,
			undefined,
			{ timeout: LOAD_TIMEOUT_MS },
		);
		for (const step of options.before ?? []) await evaluateInPage(page, step.expression);
		if (options.clip) {
			// Size the window to the box first: a page that centres its box in the viewport
			// would otherwise leave it on a half-pixel offset, which the image would carry
			// as a taller, half-shifted crop.
			const box = await page.locator(options.clip).boundingBox();
			if (!box) throw new Error(`${options.clip} is not in the document`);
			await page.setViewportSize({
				width: Math.max(options.width, Math.ceil(box.width)),
				height: Math.ceil(box.height),
			});
			await page.waitForTimeout(100);
			await page.locator(options.clip).screenshot({ path: options.out, animations: "disabled" });
			return;
		}
		// The image is the document, not the window: a page can be wider than the
		// width it was given — the gallery is `80ch` of monospace whatever the pixel
		// width — and a narrow window reflows it into a different, taller page. Size
		// the window to the document first, so the capture is one layout rather than
		// a narrow measurement of a wide render. A window is also floored at its own
		// minimum and at the viewport height, so both come from the document.
		// The width first: a narrow window reflows the page, so the height has to be
		// measured once the document sits at its own width.
		const contentWidth = await page.evaluate<number>("Math.ceil(document.documentElement.scrollWidth)");
		const width = Math.max(options.width, contentWidth);
		if (width !== options.width) await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
		const contentHeight = await page.evaluate<number>("Math.ceil(document.body.getBoundingClientRect().height)");
		await page.setViewportSize({ width, height: Math.max(1, contentHeight) });
		// A last frame for the layout that resize may have changed.
		await page.waitForTimeout(100);
		await page.screenshot({ path: options.out, fullPage: true, animations: "disabled" });
	} finally {
		await browser.close();
	}
}
