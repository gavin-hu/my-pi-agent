/**
 * Screenshot the browser plan review page with headless Chrome (dev tooling).
 *
 * Renders a plan file through the real review page — the same server, router,
 * client bundle, theme bootstrap, and Markdown renderer a `/plan review` session
 * serves — and writes a full-page PNG, so the document's layout can be checked
 * without opening a browser by hand. It is macOS-friendly (it finds Google
 * Chrome's bundle) and honours `PI_CHROME` for another Chrome or Chromium.
 *
 *   bun run screenshot:plan <plan.md> [-o out.png] [--width 1280]
 *     [--theme light|dark] [--scale 2] [--wait 8000] [--as owner|reviewer]
 *     [--post <name>] [--draft <text>] [--share]
 *
 * The plan path is any Markdown file; the review page, not the CLI, decides how
 * it renders. Output defaults to `<plan-stem>.png` in the working directory.
 * `--as reviewer` captures the page a shared link opens, `--post <name>` posts one
 * comment as that reviewer first (so the frame shows the name bound to the link),
 * `--draft <text>` starts the tab with one unsaved comment, the state a reload
 * produces, and `--share` captures the owner's Share dialog with two links.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createPlanWebReview, type PlanReviewSession, type PlanWebReview } from "../../extensions/plan/web.ts";
import type { NetworkInterfaces } from "../../extensions/plan/web-share.ts";
import { parseShotArgs, runCli } from "../cli.ts";
import { anchorOf, captureStore, draftSeed, postAsReviewer, storedPlan } from "./plan-review-capture.ts";
import { type PageShotOptions, capturePage } from "../capture/page.ts";

/** Which role's page to capture. */
export type ShotRole = "owner" | "reviewer";

/** The token every capture uses, so a minted link's URL is stable in a frame. */
const TOKEN = "screenshot";

/** CLI options after parsing. */
export interface ShotOptions extends PageShotOptions {
	/** Absolute plan path. */
	plan: string;
	/** Whose page to capture: the owner's own, or the link a reviewer opens. */
	role: ShotRole;
	/** Reviewer name to post a comment as before the capture, binding the link. */
	post?: string;
	/** Unsaved comment to seed the tab with, which the client restores on boot. */
	draft?: string;
	/** Capture the owner's Share dialog instead of the plan, with two links on it. */
	share?: boolean;
}

/** Parse the command line; throws a message the caller prints as usage. */
export function parseArgs(argv: string[]): ShotOptions {
	const parsed = parseShotArgs(argv, {
		out: "",
		scale: 2,
		maxPositional: 1,
		extraFlags: ["--as", "--post", "--draft"],
		extraBooleans: ["--share"],
	});
	const plan = parsed.positional[0] ?? "";
	if (!plan) throw new Error("a plan path is required");
	const role = parsed.values["--as"] ?? "owner";
	if (role !== "owner" && role !== "reviewer") throw new Error("--as must be owner or reviewer");
	const share = parsed.flags.has("--share");
	// The dialog is the owner's own surface: a reviewer's page has no Share button.
	if (share && role !== "owner") throw new Error("--share captures the owner's Share dialog, not a reviewer's page");
	// A name is bound by posting through a reviewer link, which a reviewer page and a
	// shared dialog both have; nothing else binds one.
	const post = parsed.values["--post"];
	if (post !== undefined) {
		if (role !== "reviewer" && !share) throw new Error("--post needs --as reviewer or --share");
		if (post.trim() === "") throw new Error("--post needs a reviewer name");
	}
	// A bound link already has its name, so the two states cannot share a frame.
	const draft = parsed.values["--draft"];
	if (draft !== undefined && post !== undefined) throw new Error("--draft cannot be combined with --post");
	if (draft !== undefined && draft.trim() === "") throw new Error("--draft needs the comment text");
	const planPath = resolve(plan);
	return {
		plan: planPath,
		out: resolve(parsed.out || `${basename(planPath).replace(/\.md$/i, "")}.png`),
		width: parsed.width,
		scale: parsed.scale,
		theme: parsed.theme,
		waitMs: parsed.waitMs,
		role,
		...(post === undefined ? {} : { post }),
		...(draft === undefined ? {} : { draft }),
		...(!share ? {} : { share }),
	};
}

/** The plan review page needs its blocks and the state chip before capture. */
const READY = `(function () {
	var state = document.getElementById("review-state");
	return document.querySelectorAll("#plan .bf-block").length > 0 &&
		!!state && /Connected|Saved|Offline/.test(state.textContent || "");
})()`;

/**
 * The Share dialog opens on request, not on load, so the capture opens it through
 * the page's own button and waits for the per-person list to render. The click is
 * made once: the poll runs again on every frame until the list arrives.
 */
const SHARE_READY = `(function () {
	if (document.querySelectorAll("#share-links .review-share__row").length > 1) return true;
	if (!window.__shareShot) {
		window.__shareShot = true;
		var button = document.getElementById("share");
		if (button) button.click();
	}
	return false;
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
	const capture = captureStore(plan);
	// Drive the shipped review server: an in-memory store serves the file, the
	// browser opener is suppressed, and the token is fixed so the URL is stable.
	const review = createPlanWebReview(capture.store, {
		open: () => {},
		token: () => TOKEN,
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
		// A posted comment is what binds the name to the link, so the frame shows the
		// state a teammate's page reaches after writing once.
		if (options.post !== undefined && options.role === "reviewer") {
			await postAsReviewer(url, options.post, anchorOf(capture.content()));
		}
		if (options.share) await mintShareLinks(review, session, options.post, anchorOf(capture.content()));
		await capturePage({
			url,
			out: options.out,
			width: options.width,
			scale: options.scale,
			theme: options.theme,
			waitMs: options.waitMs,
			ready: options.share ? `(${READY}) && (${SHARE_READY})` : READY,
			...(options.draft === undefined ? {} : { init: [draftSeed(capture.content(), options.draft)] }),
		});
	} finally {
		await session.close();
	}
}

/**
 * Two links on the dialog, because a one-row list is the single-link state the page
 * already had: the first is bound when `--post` named a reviewer, and the second is
 * minted the way **New link** mints one.
 */
async function mintShareLinks(
	review: PlanWebReview,
	session: PlanReviewSession,
	name: string | undefined,
	anchor: number,
): Promise<void> {
	const first = (await review.share())?.state.links[0];
	if (!first) throw new Error("could not mint a reviewer link");
	if (name !== undefined) await postAsReviewer(first.url, name, anchor);
	const response = await fetch(`http://127.0.0.1:${session.port}/api/share/link?token=${TOKEN}`, { method: "POST" });
	if (!response.ok) throw new Error(`the review refused a second link: ${response.status}`);
}

const USAGE = `usage: bun run screenshot:plan <plan.md> [-o out.png] [--width 1280] [--theme light|dark] [--scale 2] [--wait 8000] [--as owner|reviewer] [--post <name>] [--draft <text>] [--share]`;

if (import.meta.main) {
	runCli(USAGE, async () => {
		const options = parseArgs(process.argv.slice(2));
		await capture(options);
		console.log(options.out);
	});
}
