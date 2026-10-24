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
 *     [--theme light|dark] [--scale 2] [--wait 8000] [--as owner|reviewer]
 *
 * The plan path is any Markdown file; the review page, not the CLI, decides how
 * it renders. Output defaults to `<plan-stem>.png` in the working directory, and
 * `--as reviewer` captures the page a shared link opens.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type PlanStore, type StoredPlan } from "../extensions/plan/plans.ts";
import { createPlanWebReview } from "../extensions/plan/web.ts";
import type { NetworkInterfaces } from "../extensions/plan/web-share.ts";
import { parseShotArgs, runCli } from "./cli.ts";
import { type PageShotOptions, capturePage } from "./web-shot.ts";

/** Which role's page to capture. */
export type ShotRole = "owner" | "reviewer";

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Absolute plan path. */
	plan: string;
	/** Whose page to capture: the owner's own, or the link a reviewer opens. */
	role: ShotRole;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, { out: "", scale: 2, maxPositional: 1, extraFlags: ["--as"] });
	const plan = parsed.positional[0] ?? "";
	if (!plan) throw new Error("a plan path is required");
	const role = parsed.values["--as"] ?? "owner";
	if (role !== "owner" && role !== "reviewer") throw new Error("--as must be owner or reviewer");
	const planPath = resolve(plan);
	return {
		plan: planPath,
		out: resolve(parsed.out || `${basename(planPath).replace(/\.md$/i, "")}.png`),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
		role,
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
		rootFor: async () => undefined,
		write: readOnly,
		setSteps: readOnly,
		saveFeedback: readOnly,
		read: async () => plan,
		latest: async () => plan,
		index: async () => [],
		takeNotice: () => undefined,
	};
}

/** The plan review page needs its blocks and the state chip before capture. */
const READY = `(function () {
	var state = document.getElementById("review-state");
	return document.querySelectorAll("#plan .bf-block").length > 0 &&
		!!state && /Connected|Saved|Offline/.test(state.textContent || "");
})()`;

/**
 * A reviewer shot needs a reachable address to share to. This snapshot reports
 * loopback as a LAN address, so the capture mints a real reviewer link without
 * opening a real interface.
 */
const LOOPBACK_AS_LAN: NetworkInterfaces = {
	lo0: [
		{
			address: "127.0.0.1",
			netmask: "255.0.0.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: "127.0.0.1/8",
		},
	],
};

/** Render one plan and capture it. */
async function capture(options: ShotOptions): Promise<void> {
	const plan = storedPlan(readFileSync(options.plan, "utf-8"), options.plan);
	// Drive the shipped review server: a stub store serves the file, the browser
	// opener is suppressed, and the token is fixed so the URL is stable.
	const review = createPlanWebReview(screenshotStore(plan), {
		open: () => {},
		token: () => "screenshot",
		port: 0,
		networkInterfaces: () => LOOPBACK_AS_LAN,
	});
	const session = await review.start(process.cwd(), plan, { canApprove: true });
	if (!session) throw new Error("could not bind the review server");
	try {
		// The reviewer's page is the one its own link serves, so the shot mints one
		// rather than reusing the owner's token.
		let url = session.url;
		if (options.role === "reviewer") {
			const link = (await review.share())?.state.links[0];
			if (!link) throw new Error("could not mint a reviewer link");
			url = link.url;
		}
		await capturePage({
			url,
			out: options.out,
			width: options.width,
			scale: options.scale,
			theme: options.theme,
			waitMs: options.waitMs,
			ready: READY,
		});
	} finally {
		await session.close();
	}
}

const USAGE = `usage: bun run scripts/plan-review-shot.ts <plan.md> [-o out.png] [--width 1280] [--theme light|dark] [--scale 2] [--wait 8000] [--as owner|reviewer]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	});
}
