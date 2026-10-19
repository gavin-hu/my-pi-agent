/**
 * Full-page PNG capture with headless Chrome (dev tooling).
 *
 * Shared by `plan-review-shot.ts` and `tool-renderings.ts`: it launches Chrome
 * with a DevTools port, attaches over CDP, and captures the whole document —
 * beyond the viewport — in one shot, so a page taller than the window (a plan,
 * a gallery of tool blocks) is not clipped. Chrome is found in its usual macOS
 * bundle locations, or through `PI_CHROME`.
 *
 * Value-only apart from the launch itself: the caller supplies the URL, the
 * expressions to evaluate before the capture, and the output path.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { sleep } from "./poll.ts";

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

/** One expression evaluated in the page before the capture. */
export interface ChromeShotStep {
	/** JavaScript evaluated in the page. */
	expression: string;
	/** Await the expression's promise (for a readiness poll). */
	awaitPromise?: boolean;
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
	/** Expressions run in order before the capture. */
	before?: ChromeShotStep[];
}

interface CdpTarget {
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

interface CdpMessage {
	id?: number;
	result?: unknown;
	error?: { message?: string };
}

/** Launch Chrome with a debugging port; returns the child and the port. */
async function launchChrome(
	profile: string,
	url: string,
	width: number,
): Promise<{ child: ChildProcess; port: number }> {
	const child = spawn(
		chromeBinary(),
		[
			"--headless=new",
			"--disable-gpu",
			"--disable-extensions",
			"--hide-scrollbars",
			"--no-first-run",
			"--no-default-browser-check",
			"--force-prefers-reduced-motion",
			`--window-size=${width},900`,
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			url,
		],
		{ stdio: "ignore" },
	);
	const portFile = `${profile}/DevToolsActivePort`;
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (existsSync(portFile)) {
			const port = Number(readFileSync(portFile, "utf-8").split("\n")[0]?.trim());
			if (port) return { child, port };
		}
		await sleep(50);
	}
	child.kill("SIGKILL");
	throw new Error("Chrome did not open a DevTools port.");
}

/** Find the page target once Chrome has opened it. */
async function pageTarget(port: number, origin: string, deadline: number): Promise<CdpTarget> {
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const list = (await response.json()) as CdpTarget[];
			const page = list.find((target) => target.type === "page" && target.url.startsWith(origin));
			if (page?.webSocketDebuggerUrl) return page;
		} catch {
			// The endpoint is not up yet; keep polling until the deadline.
		}
		if (Date.now() > deadline) throw new Error("Chrome opened no page target.");
		await sleep(100);
	}
}

/** A tiny CDP client over the page's DevTools WebSocket. */
class Cdp {
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as CdpMessage;
			if (message.id === undefined) return;
			const entry = this.pending.get(message.id);
			if (!entry) return;
			this.pending.delete(message.id);
			if (message.error) entry.reject(new Error(message.error.message ?? "CDP error"));
			else entry.resolve(message.result);
		});
	}

	static async open(url: string): Promise<Cdp> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error("Could not attach to Chrome.")), { once: true });
		});
		return new Cdp(socket);
	}

	send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		this.socket.close();
	}
}

/** Chrome's message when an evaluation lands in a context that is being replaced. */
const NAVIGATION_RACE = /context was destroyed|Cannot find context|Inspected target navigated/i;

/**
 * Evaluate in the page, retrying while Chrome finishes a navigation. The target
 * exists before its first document commits, so an immediate evaluate can land in
 * a context that is about to be replaced.
 */
async function evaluate<T>(cdp: Cdp, expression: string, awaitPromise = false): Promise<T | undefined> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			const result = await cdp.send<{
				result?: { value?: T };
				exceptionDetails?: { text?: string; exception?: { description?: string } };
			}>("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
			// A page expression that throws resolves with exceptionDetails instead of
			// rejecting; surfacing it keeps a broken step from producing a wrong image.
			const failure = result.exceptionDetails;
			if (failure) throw new Error(failure.exception?.description ?? failure.text ?? "page expression failed");
			return result.result?.value;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!NAVIGATION_RACE.test(message)) throw error;
			await sleep(100);
		}
	}
	throw new Error("Chrome kept replacing the page context.");
}

/**
 * Resolve once the requested document has loaded. Chrome lists the page target
 * before its first document commits, so an immediate evaluate can land in the
 * tab's `about:blank`, where a step silently does nothing; polling for the
 * origin and `complete` waits for the real page.
 */
function loadExpression(origin: string): string {
	return `new Promise(function (resolve) {
	var done = function () {
		return location.href.indexOf(${JSON.stringify(origin)}) === 0 && document.readyState === "complete";
	};
	if (done()) { resolve(true); return; }
	var timer = setInterval(function () { if (done()) { clearInterval(timer); resolve(true); } }, 50);
	setTimeout(function () { clearInterval(timer); resolve(false); }, 15000);
})`;
}

/**
 * Capture `options.url` as one full-page PNG. The document is measured and the
 * whole column captured with `captureBeyondViewport`, at the requested scale.
 */
export async function captureFullPage(options: ChromeShotOptions): Promise<void> {
	const profile = mkdtempSync(`${tmpdir()}/pi-chrome-shot-`);
	let chrome: ChildProcess | undefined;
	let cdp: Cdp | undefined;
	try {
		const launched = await launchChrome(profile, options.url, options.width);
		chrome = launched.child;
		const target = await pageTarget(launched.port, options.origin, Date.now() + 15_000);
		cdp = await Cdp.open(target.webSocketDebuggerUrl as string);
		await cdp.send("Page.enable");
		await evaluate(cdp, loadExpression(options.origin), true);
		for (const step of options.before ?? []) {
			await evaluate(cdp, step.expression, step.awaitPromise ?? false);
		}
		await sleep(100);
		// The document may be taller than the window; measure its own height and
		// capture that whole column, at the requested device scale. `cssContentSize`
		// floors at the viewport, which would pad a short page with empty rows.
		const content = await evaluate<{ width?: number; height?: number }>(
			cdp,
			"({ width: document.documentElement.scrollWidth, height: Math.ceil(document.body.getBoundingClientRect().height) })",
		);
		const metrics = await cdp.send<{ cssContentSize?: { width: number; height: number } }>("Page.getLayoutMetrics");
		const fallback = metrics.cssContentSize ?? { width: options.width, height: 900 };
		const size = {
			width: content?.width && content.width > 0 ? content.width : fallback.width,
			height: content?.height && content.height > 0 ? content.height : fallback.height,
		};
		const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			fromSurface: true,
			clip: { x: 0, y: 0, width: size.width, height: size.height, scale: options.scale ?? 2 },
		});
		writeFileSync(options.out, Buffer.from(shot.data, "base64"));
	} finally {
		cdp?.close();
		chrome?.kill("SIGKILL");
		rmSync(profile, { recursive: true, force: true });
	}
}
