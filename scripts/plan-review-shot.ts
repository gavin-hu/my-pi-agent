/**
 * Screenshot the browser plan review page with headless Chrome (dev tooling).
 *
 * Renders a plan file through the real review page — the same server, router,
 * client bundle, theme bootstrap, and Markdown renderer a `/plan review` session
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
import { basename, resolve } from "node:path";
import { type PlanStore, type StoredPlan } from "../extensions/plan/plans.ts";
import { createPlanWebReview } from "../extensions/plan/web.ts";
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

/** A plan as the store would serve it, without reading or writing the disk. */
function storedPlan(content: string, path: string): StoredPlan {
	return {
		path,
		relativePath: basename(path),
		content,
		bytes: Buffer.byteLength(content, "utf-8"),
	};
}

/**
 * A `PlanStore` that serves one plan and refuses every write. The capture never
 * saves, so the write methods exist only to satisfy the interface.
 */
function screenshotStore(plan: StoredPlan): PlanStore {
	const readOnly = async (): Promise<never> => {
		throw new Error("the screenshot store is read-only");
	};
	return {
		dirFor: readOnly,
		write: readOnly,
		setSteps: readOnly,
		saveFeedback: readOnly,
		read: async () => plan,
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
	const plan = storedPlan(readFileSync(options.plan, "utf-8"), options.plan);
	// Drive the shipped review server: a stub store serves the file, the browser
	// opener is suppressed, and the token is fixed so the URL is stable.
	const review = createPlanWebReview(screenshotStore(plan), {
		open: () => {},
		token: () => "screenshot",
		port: 0,
	});
	const session = await review.start(process.cwd(), plan, { canApprove: true });
	if (!session) throw new Error("could not bind the review server");
	try {
		await captureFullPage({
			url: session.url,
			origin: new URL(session.url).origin,
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
		await session.close();
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
