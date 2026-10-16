/**
 * Screenshot the browser plan review page with headless Chrome (dev tooling).
 *
 * Renders a plan file through the real review page — the same router, client
 * bundle, theme bootstrap, and Markdown renderer a `/plan review` session
 * serves — and writes a full-page PNG, so the document's layout can be checked
 * without opening a browser by hand. It is macOS-friendly (it finds Google
 * Chrome's bundle) and honours `PI_CHROME` for another Chrome or Chromium.
 *
 *   bun run scripts/plan-review-shot.ts <plan.md> [-o out.png] [--width 1280]
 *     [--theme light|dark] [--scale 2] [--wait 8000]
 *
 * The plan path is any Markdown file; the review page, not the CLI, decides how
 * it renders. Output defaults to `<plan-stem>.png` in the working directory.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { codeBody, fenceInfo, planBlocks, planHeadings } from "../extensions/plan/blocks.ts";
import { parseFeedback, stripFeedback } from "../extensions/plan/feedback.ts";
import { planTitle } from "../extensions/plan/plans.ts";
import type { ReviewPageData } from "../extensions/plan/web-page.ts";
import { handleReviewRequest, type ReviewContext } from "../extensions/plan/web-router.ts";
import { fenceLanguage, highlightLines } from "../lib/highlight.ts";

/** Where Chrome usually lives, plus the `PI_CHROME` override. */
const CHROME_CANDIDATES = [
	process.env.PI_CHROME,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
].filter((path): path is string => Boolean(path));

/** CLI options after parsing. */
export interface ShotOptions {
	/** Absolute plan path. */
	plan: string;
	/** Absolute PNG output path. */
	out: string;
	/** CSS viewport width. */
	width: number;
	/** Device pixel ratio for a crisp capture. */
	scale: number;
	/** Optional forced theme; the page follows the system when absent. */
	theme?: "light" | "dark";
	/** How long to wait for the client to render, in milliseconds. */
	waitMs: number;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	let plan = "";
	let out = "";
	let width = 1280;
	let scale = 2;
	let theme: "light" | "dark" | undefined;
	let waitMs = 8000;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = (): string => {
			const next = argv[++i];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			return next;
		};
		if (arg === "-o" || arg === "--out") out = value();
		else if (arg === "--width") width = Number(value());
		else if (arg === "--scale") scale = Number(value());
		else if (arg === "--wait") waitMs = Number(value());
		else if (arg === "--theme") {
			const themeValue = value();
			if (themeValue !== "light" && themeValue !== "dark") throw new Error("--theme must be light or dark");
			theme = themeValue;
		} else if (arg === "-h" || arg === "--help") throw new Error("");
		else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
		else if (plan) throw new Error(`unexpected argument ${arg}`);
		else plan = arg;
	}
	if (!plan) throw new Error("a plan path is required");
	if (!Number.isFinite(width) || width < 320) throw new Error("--width must be at least 320");
	if (!Number.isFinite(scale) || scale <= 0) throw new Error("--scale must be positive");
	if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error("--wait must not be negative");
	const planPath = resolve(plan);
	return {
		plan: planPath,
		out: resolve(out || `${basename(planPath).replace(/\.md$/i, "")}.png`),
		width: Math.round(width),
		scale,
		theme,
		waitMs,
	};
}

/** Build the page data exactly as the review server does for one plan. */
export function buildReviewPageData(content: string, path: string, token: string): ReviewPageData {
	const baseline = stripFeedback(content);
	const blocks = planBlocks(baseline);
	const headings = planHeadings(blocks);
	// Highlight code once, at the boundary; the client copies only the tok-* spans.
	const code: Record<string, string[]> = {};
	for (const block of blocks) {
		if (block.kind !== "code") continue;
		const language = fenceLanguage(fenceInfo(block.lines[0] ?? ""));
		if (language) code[String(block.start)] = highlightLines(codeBody(block), language);
	}
	return {
		title: headings.find((heading) => heading.level === 1)?.text || planTitle(basename(path)),
		blocks,
		annotations: parseFeedback(content),
		outline: headings.map((heading) => ({
			id: `s-${heading.line}`,
			line: heading.line,
			level: heading.level,
			text: heading.text,
		})),
		code,
		token,
	};
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A local server that answers the review routes; the event stream stays open. */
async function serveReview(data: ReviewPageData): Promise<{ url: string; close: () => Promise<void> }> {
	const streams = new Set<ServerResponse>();
	const context: ReviewContext = {
		token: data.token,
		page: async () => data,
		save: async () => ({ ok: true }),
		onSaved: () => {},
		onCancel: () => {},
	};
	const server = createServer((request, response) => {
		void (async () => {
			const method = request.method ?? "GET";
			let body = "";
			if (method.toUpperCase() === "POST") {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(chunk as Buffer);
				body = Buffer.concat(chunks).toString("utf-8");
			}
			const result = await handleReviewRequest(context, method, request.url ?? "/", request.headers, body);
			if (result.stream) {
				response.writeHead(result.status, result.headers);
				response.write("retry: 2000\n\n");
				streams.add(response);
				request.on("close", () => streams.delete(response));
				return;
			}
			response.writeHead(result.status, result.headers);
			response.end(result.body ?? "");
		})();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}/?token=${data.token}`,
		close: async () => {
			for (const stream of streams) stream.end();
			streams.clear();
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			});
		},
	};
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

/** The plan review page needs its blocks and the state chip before capture. */
function readyExpression(waitMs: number): string {
	return `new Promise(function (resolve) {
	var done = function () {
		var state = document.getElementById("review-state");
		return document.querySelectorAll("#plan .bf-block").length > 0 &&
			!!state && /Connected|Saved|Offline/.test(state.textContent || "");
	};
	if (done()) { resolve(true); return; }
	var timer = setInterval(function () { if (done()) { clearInterval(timer); resolve(true); } }, 50);
	setTimeout(function () { clearInterval(timer); resolve(false); }, ${waitMs});
})`;
}

/**
 * The review page scrolls inside `.bf-app__main`, so the document is only a
 * viewport tall. Let the columns grow to their content for one full-page shot.
 */
const EXPAND_EXPRESSION = `(function () {
	var style = document.createElement("style");
	style.textContent = ".bf-app{height:auto !important;min-height:0 !important;overflow:visible !important}" +
		".bf-app__body{flex:none !important;height:auto !important}" +
		".bf-app__main{overflow:visible !important;height:auto !important}" +
		".bf-app__sidebar{overflow:visible !important;height:auto !important;max-height:none !important}";
	document.head.appendChild(style);
	return document.documentElement.scrollHeight;
})()`;

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
		if (Date.now() > deadline) throw new Error("Chrome opened no page target for the review page.");
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

/** The Chrome (or Chromium) binary to drive. */
export function chromeBinary(): string {
	for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
	throw new Error("Chrome not found; set PI_CHROME to a Chrome or Chromium binary.");
}

/** Render one plan and capture it. */
async function capture(options: ShotOptions): Promise<void> {
	const content = readFileSync(options.plan, "utf-8");
	const token = "screenshot";
	const data = buildReviewPageData(content, options.plan, token);
	const server = await serveReview(data);
	const origin = new URL(server.url).origin;
	const profile = mkdtempSync(`${tmpdir()}/plan-review-shot-`);
	let chrome: ChildProcess | undefined;
	let cdp: Cdp | undefined;
	try {
		const launched = await launchChrome(profile, server.url, options.width);
		chrome = launched.child;
		const target = await pageTarget(launched.port, origin, Date.now() + 15_000);
		cdp = await Cdp.open(target.webSocketDebuggerUrl as string);
		await cdp.send("Page.enable");
		if (options.theme) {
			await cdp.send("Runtime.evaluate", {
				expression: `document.documentElement.setAttribute("data-theme", ${JSON.stringify(options.theme)})`,
			});
		}
		await cdp.send("Runtime.evaluate", {
			expression: readyExpression(options.waitMs),
			awaitPromise: true,
			returnByValue: true,
		});
		await cdp.send("Runtime.evaluate", { expression: EXPAND_EXPRESSION });
		await sleep(100);
		// The document is taller than the window; measure it and capture the whole
		// column in one shot, at the requested device scale.
		const metrics = await cdp.send<{ cssContentSize?: { width: number; height: number } }>("Page.getLayoutMetrics");
		const size = metrics.cssContentSize ?? { width: options.width, height: 900 };
		const shot = (await cdp.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			fromSurface: true,
			clip: { x: 0, y: 0, width: size.width, height: size.height, scale: options.scale },
		})) as { data: string };
		writeFileSync(options.out, Buffer.from(shot.data, "base64"));
	} finally {
		cdp?.close();
		chrome?.kill("SIGKILL");
		await server.close();
		rmSync(profile, { recursive: true, force: true });
	}
}

const USAGE = `usage: bun run scripts/plan-review-shot.ts <plan.md> [-o out.png] [--width 1280] [--theme light|dark] [--scale 2] [--wait 8000]`;

if (import.meta.main) {
	try {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message || USAGE);
		if (message && !message.startsWith("--")) console.error(USAGE);
		process.exit(1);
	}
}
