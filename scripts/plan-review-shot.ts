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
import { captureFullPage, readyWhen } from "./chrome-shot.ts";
import { parseShotArgs, runCli } from "./cli.ts";
import { EXPAND_SHELL_EXPRESSION, themeExpression } from "./web-shot.ts";

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
	const parsed = parseShotArgs(argv, { out: "", scale: 2, maxPositional: 1 });
	const plan = parsed.positional[0] ?? "";
	if (!plan) throw new Error("a plan path is required");
	const planPath = resolve(plan);
	return {
		plan: planPath,
		out: resolve(parsed.out || `${basename(planPath).replace(/\.md$/i, "")}.png`),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
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
		latest: async () => plan,
		index: async () => [],
	};
}

/** The plan review page needs its blocks and the state chip before capture. */
function readyExpression(waitMs: number): string {
	return readyWhen(
		`(function () {
			var state = document.getElementById("review-state");
			return document.querySelectorAll("#plan .bf-block").length > 0 &&
				!!state && /Connected|Saved|Offline/.test(state.textContent || "");
		})()`,
		waitMs,
	);
}

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
				...(options.theme ? [{ expression: themeExpression(options.theme) }] : []),
				{ expression: readyExpression(options.waitMs), awaitPromise: true },
				{ expression: EXPAND_SHELL_EXPRESSION },
			],
		});
	} finally {
		await session.close();
	}
}

const USAGE = `usage: bun run scripts/plan-review-shot.ts <plan.md> [-o out.png] [--width 1280] [--theme light|dark] [--scale 2] [--wait 8000]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	});
}
