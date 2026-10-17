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

import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { basename, resolve } from "node:path";
import { codeBody, fenceInfo, planBlocks, planHeadings } from "../extensions/plan/blocks.ts";
import { parseFeedback, stripFeedback } from "../extensions/plan/feedback.ts";
import { planTitle } from "../extensions/plan/plans.ts";
import type { ReviewPageData } from "../extensions/plan/web-page.ts";
import { handleReviewRequest, type ReviewContext } from "../extensions/plan/web-router.ts";
import { fenceLanguage, highlightLines } from "../lib/highlight.ts";
import { captureFullPage } from "./chrome-shot.ts";

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
		// The capture always shows the approval action, even though the real page
		// gates it to the exit_plan_mode flow.
		canApprove: true,
		token,
	};
}

/** A local server that answers the review routes; the event stream stays open. */
async function serveReview(data: ReviewPageData): Promise<{ url: string; close: () => Promise<void> }> {
	const streams = new Set<ServerResponse>();
	const context: ReviewContext = {
		token: data.token,
		canApprove: true,
		page: async () => data,
		save: async () => ({ ok: true }),
		onSaved: () => {},
		onApprove: () => {},
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

/** Render one plan and capture it. */
async function capture(options: ShotOptions): Promise<void> {
	const content = readFileSync(options.plan, "utf-8");
	const token = "screenshot";
	const data = buildReviewPageData(content, options.plan, token);
	const server = await serveReview(data);
	try {
		await captureFullPage({
			url: server.url,
			origin: new URL(server.url).origin,
			out: options.out,
			width: options.width,
			scale: options.scale,
			before: [
				...(options.theme
					? [{ expression: `document.documentElement.setAttribute("data-theme", ${JSON.stringify(options.theme)})` }]
					: []),
				{ expression: readyExpression(options.waitMs), awaitPromise: true },
				{ expression: EXPAND_EXPRESSION },
			],
		});
	} finally {
		await server.close();
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
