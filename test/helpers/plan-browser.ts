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
import { launchBrowser, suiteTab, type TestBrowser } from "./browser.ts";
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
	const page = await suiteTab(browser);
	// A draft is this tab's, and a suite's fixtures share one origin: a case must open on an empty
	// store, and a blocked one is not this case's failure.
	await page
		.evaluate(() => {
			const view = globalThis as unknown as {
				sessionStorage?: { clear(): void };
				localStorage?: { clear(): void };
			};
			view.sessionStorage?.clear();
			view.localStorage?.clear();
		})
		.catch(() => undefined);
	await page.goto(url, { waitUntil: "load" });
	await drawnReview(page);
	return page;
}

/** What the page said when the gate gave up, named so a red does not have to be re-derived. */
export interface DrawnState {
	readyState: string;
	blocks: number;
	outline: boolean;
}

/**
 * The state the gate polls: the document finished and the rail's blocks in it.
 *
 * Serialized into the page, so the document arrives through `globalThis` by name — this project's
 * TypeScript has no DOM lib (`Doc` above is the same shape for the same reason).
 */
function drawnState(): boolean {
	const page = globalThis as unknown as {
		document: { readyState: string; querySelectorAll(selector: string): { length: number } };
	};
	return page.document.readyState === "complete" && page.document.querySelectorAll("#plan .bf-block[id]").length > 0;
}

/** Read the state the gate is waiting on, so a timeout can report it rather than a selector. */
async function readState(page: Page): Promise<DrawnState> {
	return page.evaluate(() => {
		const viewed = globalThis as unknown as {
			document: {
				readyState: string;
				querySelector(selector: string): unknown;
				querySelectorAll(selector: string): { length: number };
			};
		};
		return {
			readyState: viewed.document.readyState,
			blocks: viewed.document.querySelectorAll("#plan .bf-block[id]").length,
			outline: viewed.document.querySelector("#outline-list") !== null,
		};
	});
}

/** One state as the message states it: the three facts a stalled paint is diagnosed by. */
function describeState(state: DrawnState): string {
	const outline = state.outline ? "present" : "absent";
	return `readyState "${state.readyState}", ${state.blocks} "#plan .bf-block[id]", outline-list ${outline}`;
}

/**
 * The line a retry prints: which attempt drew, the budget it waited under, and what the other saw.
 *
 * The budget is named with its owner because this path is forced on purpose: a case that hands
 * `drawnReview` its own budget retries without any flake, so a reader of the log has to tell the two
 * apart without opening the suite. `REVIEW_PAINT_MS` reads as the gate's, any other number as the
 * case's. The convention that keeps it meaningful — **a case that forces a retry passes its own
 * budget** — is the part no case can enforce, which is why it is stated rather than relied on.
 */
export function retryLine(attempt: number, budgetMs: number, seen: readonly string[]): string {
	const budget =
		budgetMs === REVIEW_PAINT_MS ? `the gate's ${budgetMs}ms budget` : `a ${budgetMs}ms budget this case passed`;
	return `the plan review drew on attempt ${attempt} under ${budget}: ${seen.join("; ")}`;
}

/**
 * Wait until the page has drawn the rail, and say what it saw when it has not.
 *
 * The gate this replaces was `waitForSelector("#plan .bf-block")` on the same ten seconds, which
 * named a selector and nothing else: when `windows-latest` missed it once on a first paint, the red
 * could not say whether the document was still loading, the script had not run, or the rail was
 * empty. Polling the state through `waitForFunction` is the same wait carrying the page's own
 * answer, and one retry absorbs the cold first navigation behind that red.
 *
 * The retry is reported, because a flake that is absorbed silently is indistinguishable from a paint
 * that is getting worse: a second attempt prints `retryLine`, which names what the first one saw and
 * which budget it waited under, so the suite shows the event before it shows a failure and the log
 * tells the gate's miss apart from a case's forced one. The budget stays `REVIEW_PAINT_MS` for both
 * attempts — the number was never the subject — and a page that never draws fails naming the state
 * it kept.
 */
export async function drawnReview(page: Page, budgetMs: number = REVIEW_PAINT_MS): Promise<void> {
	const seen: string[] = [];
	for (let attempt = 1; attempt <= 2; attempt++) {
		const started = Date.now();
		try {
			await page.waitForFunction(drawnState, undefined, { timeout: budgetMs });
			if (attempt > 1) console.warn(retryLine(attempt, budgetMs, seen));
			return;
		} catch {
			seen.push(`attempt ${attempt} waited ${Date.now() - started}ms and saw ${describeState(await readState(page))}`);
			if (attempt === 2) throw new Error(`the plan review never drew: ${seen.join("; ")}`);
			await page.reload({ waitUntil: "load" }).catch(() => undefined);
		}
	}
}
