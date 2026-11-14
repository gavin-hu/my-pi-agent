/**
 * The shipped plan review page in a browser, with its stream in the case's hands.
 *
 * `plan-web.ts` builds the page and its fixtures; this boots the reader's side of it — a
 * headless Chrome, a mount of the shipped router under the review's own prefix, and the
 * frame a real plan edit would broadcast. Two suites drive the page now (what a reviewer
 * can do on it, and what a live frame repaints), and a bootstrap written twice is how one
 * of them ends up waiting for the other's idea of "loaded": a case passes the page it
 * wants and the router it wants it answered by, and everything below that is one statement.
 *
 * A machine with no browser has `REVIEW_CHROME === undefined`, which a suite hands to
 * `describe.skipIf` so `bun run check` stays green there and still says why nothing ran.
 */

import { type Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import { LOOPBACK_HOSTS } from "../../lib/http/index.ts";
import { launchBrowser, type TestBrowser } from "./browser.ts";
import type { PlanAnnotation } from "../../extensions/plan/feedback.ts";
import type { ReviewPageData } from "../../extensions/plan/web-page.ts";
import type { ReviewContext, SaveResult } from "../../extensions/plan/web-router.ts";
import { reviewAt } from "./fixtures/plan-web.ts";
import { testMountSource } from "./serve.ts";

/** The browser this machine has; absent means a browser suite is skipped, naming `PI_CHROME`. */
export const REVIEW_CHROME = findChrome();

/** How long a page gets to paint what its fixture holds. */
export const REVIEW_PAINT_MS = 10_000;

/**
 * The prefix the fixture review answers under: the review's own `/plan/<id>` shape, because
 * the mount is what strips it, and a page served at the origin's root would not prove the
 * page's own URLs are built from that prefix.
 */
export const REVIEW_MOUNT_BASE = "/plan/probe";

/**
 * The sliver of the DOM a predicate reads.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page,
 * so it reaches the document through this shape by name.
 */
export interface Doc {
	querySelector(selector: string): { textContent: string | null } | null;
	querySelectorAll(selector: string): { length: number };
}

/** A frame the page's stream sends: the kind is what the refetch reads. */
export type ReviewFrame = "plan" | "comment";

/** One stored comment, which is what the rail and the counts exist for. */
export const REVIEW_ANNOTATION: PlanAnnotation = { anchor: 0, comment: "needs a rollback step", author: "priya" };

/** The page both suites serve: two sections, one stored comment, and a step list to count. */
export const REVIEW_PAGE: ReviewPageData = {
	base: REVIEW_MOUNT_BASE,
	title: "Add rate limiting",
	path: "~/.pi/agent/plans/probe/add-rate-limiting.md",
	blocks: [
		{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"], level: 1, text: "Add rate limiting" },
		{ start: 1, end: 1, kind: "paragraph", lines: ["Start with the token bucket."] },
		{ start: 2, end: 2, kind: "blank", lines: [] },
		{ start: 3, end: 3, kind: "heading", lines: ["## Rollout"], level: 2, text: "Rollout" },
		{ start: 4, end: 4, kind: "paragraph", lines: ["Ship behind a flag."] },
	],
	annotations: [REVIEW_ANNOTATION],
	outline: [
		{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" },
		{ id: "s-3", line: 3, level: 2, text: "Rollout" },
	],
	steps: { done: 1, total: 3 },
	code: {},
	limits: { comments: 200, comment: 2000, quote: 500 },
	canApprove: true,
	role: "owner",
	token: "tok",
	rev: "rev-1",
};

/** One review on a loopback port: where it is, how a case writes a frame, and the close it owns. */
export interface ReviewMount {
	origin: string;
	url: string;
	/** Write the frame a broadcast would, to every stream this mount has open. */
	push(kind: ReviewFrame): void;
	/** Close the listener; the case owns it, the way `serve` hands one out. */
	close(): Promise<void>;
}

/** The review's own router, answering the shipped page and its script over HTTP. */
function context(page: () => ReviewPageData): ReviewContext {
	return {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => page(),
		save: async (): Promise<SaveResult> => ({ ok: true }),
		share: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		invite: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		revoke: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		stopShare: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		onSaved: () => {},
		onApprove: () => {},
		onCancel: () => {},
	};
}

/**
 * Serve one review: the shipped router, on the shipped mount.
 *
 * `testMountSource()` is the server `serve` runs, so the prefix stripping, the SSE head and
 * the close path are the real ones; the case owns the returned close. `page` is read on
 * every request, so a case that hands a getter re-serves the page its next refetch asks for.
 */
export async function mountReview(
	page: ReviewPageData | (() => ReviewPageData),
	overrides: Partial<ReviewContext> = {},
): Promise<ReviewMount> {
	const current = typeof page === "function" ? page : () => page;
	const ctx = { ...context(current), ...overrides };
	// The review's own sink, so a case can write the frame a real change would: the mount
	// hands the router's stream to whatever serves it, and here that is the test.
	const sinks = new Set<{ write(frame: string): void }>();
	const mount = await testMountSource()({
		session: "s1",
		prefix: REVIEW_MOUNT_BASE,
		// The mount reads the body, so a POST reaches the router with what the page wrote;
		// the review's own cap is a megabyte.
		maxBodyBytes: 1024 * 1024,
		async handler(request) {
			const answer = await reviewAt(request, ctx);
			// The router answers a stream marker; the mount needs the sink that goes with it.
			if (!answer.stream) return { result: answer };
			return {
				result: answer,
				openSink: (sink) => {
					sinks.add(sink);
					return () => sinks.delete(sink);
				},
			};
		},
	});
	if (mount.kind !== "mounted") throw new Error(`the review did not mount: ${mount.reason}`);
	const { origin, base, release } = mount.mount;
	return {
		origin,
		url: `${origin}${base}/?token=tok`,
		close: release,
		push: (kind) => {
			for (const sink of sinks) sink.write(`data: ${kind}\n\n`);
		},
	};
}

/** The browser a review suite drives. */
export async function launchReviewBrowser(): Promise<TestBrowser> {
	return launchBrowser(REVIEW_CHROME);
}

/** One tab on the served review, waited until its blocks have painted. */
export async function openReview(browser: TestBrowser, url: string): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
	await page.goto(url, { waitUntil: "load" });
	await page.waitForSelector("#plan .bf-block", { timeout: REVIEW_PAINT_MS });
	return page;
}
