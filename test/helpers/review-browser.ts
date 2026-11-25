/**
 * The shipped code review page in a browser, over a snapshot a case can move.
 *
 * The page's rules are DOM facts after an interaction — a draft restored into a composer, a
 * filter that leaves the diff readable, a selection that follows a key — and none of them is
 * visible to a string assertion. This boots the reader's side: a headless Chrome, a mount of
 * the shipped router under its own prefix, and a stub reader whose fingerprint a case moves
 * the way a committed edit would.
 *
 * A machine with no browser has `REVIEW_CHROME === undefined`, which a suite hands to
 * `describe.skipIf` so `bun run check` stays green there and still says why nothing ran.
 */

import type { Page } from "playwright-core";
import { findChrome } from "../../scripts/capture/chrome.ts";
import type { DiffLine } from "../../lib/diff/parse.ts";
import type { ReviewSnapshot } from "../../extensions/code-review/git/diff.ts";
import type { ReviewCurrent } from "../../extensions/code-review/review/current.ts";
import { createReviewStore } from "../../extensions/code-review/review/store.ts";
import { createReviewHandler } from "../../extensions/code-review/transport/router.ts";
import { suiteTab, type TestBrowser } from "./browser.ts";
import { testMountSource } from "./serve.ts";

/** The browser this machine has; absent means a browser suite is skipped, naming `PI_CHROME`. */
export const REVIEW_CHROME = findChrome();

/** How long a page gets to paint, or to answer after an interaction. */
export const REVIEW_PAINT_MS = 10_000;

/** The prefix the page answers under, as `serve` mounts it. */
export const REVIEW_MOUNT = "/review";

/**
 * One file: a hunk head, then `lines` context rows and one added line. With `lines` absent it
 * is three numbered rows (two context and an add) — the shape the cursor cases count on. `paired`
 * replaces the context rows with one removed and one added row, so a case can select across the
 * two sides of a change.
 */
function fileRows(rel: string, start: number, lines = 0, paired = false, skew = 0): ReviewSnapshot["files"][number] {
	const body: DiffLine[] = [];
	let del = 0;
	let hunk = `@@ -${start},2 +${start + skew},3 @@`;
	if (paired) {
		del = 1;
		hunk = `@@ -${start} +${start} @@`;
		body.push(
			{ kind: "del", text: "const gone = 0;", oldNo: start },
			{ kind: "add", text: "const here = 1;", newNo: start + skew },
		);
	} else if (lines > 0) {
		for (let index = 0; index < lines; index++) {
			body.push({
				kind: "ctx",
				text: `const v${index} = ${index};`,
				oldNo: start + index,
				newNo: start + index + skew,
			});
		}
		body.push({ kind: "add", text: "const more = 0;", newNo: start + lines + skew });
	} else {
		body.push(
			{ kind: "ctx", text: "const one = 1;", oldNo: start, newNo: start + skew },
			{ kind: "ctx", text: "const two = 2;", oldNo: start + 1, newNo: start + 1 + skew },
			{ kind: "add", text: "const three = 3;", newNo: start + 2 + skew },
		);
	}
	return {
		rel,
		status: "M",
		add: 1,
		del,
		binary: false,
		truncated: false,
		lines: [{ kind: "hunk", text: hunk }, ...body],
	};
}

/** A snapshot's shape a case may move: where a file starts, how tall it is, and how many files. */
export interface SnapshotOptions {
	/** The first line of the first file's hunk; default 1. */
	start?: number;
	/** Append a second file, so a move can cross into it. */
	second?: boolean;
	/** One removed row and one added row instead of the context rows: two sides of one change. */
	paired?: boolean;
	/** Context rows per file (plus the added line); absent keeps the three-row shape. */
	lines?: number;
	/** How many files; overrides `second` when given. */
	files?: number;
	/**
	 * How far the new numbering runs ahead of the old one, as an earlier hunk's insertion leaves it:
	 * the old and new columns of one context row then name different numbers. Absent is zero.
	 */
	skew?: number;
}

/** One snapshot of `files` files, each with a hunk and its body. */
export function reviewSnapshot(fingerprint: string, options: SnapshotOptions = {}): ReviewSnapshot {
	const start = options.start ?? 1;
	const count = options.files ?? (options.second ? 2 : 1);
	const files: ReviewSnapshot["files"] = [];
	for (let index = 0; index < count; index++) {
		const rel = options.files === undefined ? (index === 0 ? "a.ts" : "b.ts") : `f${index + 1}.ts`;
		files.push(
			fileRows(
				rel,
				index === 0 ? start : 40 + (index - 1) * 40,
				options.lines ?? 0,
				options.paired === true,
				options.skew ?? 0,
			),
		);
	}
	return {
		scope: "base",
		base: "main",
		label: "main...HEAD",
		files,
		omitted: 0,
		insertions: files.length,
		deletions: 0,
		fingerprint,
	};
}

/** One served review page: where it is, how a case moves it, and the close it owns. */
export interface ReviewPageFixture {
	url: string;
	/** Move the fingerprint, as a committed edit would; the page's next write sees it. */
	move(): void;
	/**
	 * Rearrange the diff, as a commit that moves its hunks does: the lines drawn change and the
	 * fingerprint moves with them, which `move()` alone does not do.
	 */
	reshape(next: SnapshotOptions): void;
	/** The fingerprint the reader answers with now. */
	rev(): string;
	/**
	 * End the server's page, as closing it from the session does while a tab is still open: the
	 * next write answers `NO_PAGE`, and the page a reviewer is looking at is refused, not lost.
	 */
	closePage(): void;
	/** Close the listener; the case owns it, the way `serve` hands one out. */
	close(): Promise<void>;
}

/**
 * One comment a case starts the page with.
 *
 * Written through the store before the page is served, so a case can read the state a reviewer
 * reaches when a diff moves: a comment on a line an earlier render drew, and this one does not.
 */
export interface SeedComment {
	rel: string;
	line: number;
	side?: "new" | "old";
	body: string;
}

/**
 * Serve one review page over a stub reader and the real store and routes.
 *
 * `testMountSource()` is the server `serve` runs, so the prefix stripping, the body cap and
 * the close path are the real ones; only the diff is a fixture.
 */
export async function mountReviewPage(
	options: SnapshotOptions = {},
	seed: readonly SeedComment[] = [],
): Promise<ReviewPageFixture> {
	let fingerprint = "rev-1";
	let shape = options;
	let minted = 0;
	const store = createReviewStore({ mint: () => `token${++minted}`.padEnd(32, "a"), now: () => 1 });
	if (seed.length > 0) {
		const page = store.open("base", "", "");
		for (const entry of seed) {
			store.write(page.token, "rev-1", "rev-1", {
				kind: "comment",
				rel: entry.rel,
				line: entry.line,
				side: entry.side ?? "new",
				body: entry.body,
			});
		}
	}
	const reader = {
		baseRef: async () => "main",
		text: async () => ({ kind: "text" as const, lines: [], binary: false, truncated: false }),
		snapshot: async () => ({ kind: "snapshot" as const, snapshot: reviewSnapshot(fingerprint, shape) }),
	};
	const current: ReviewCurrent = {
		place: () => ({ root: "/tmp/probe", repo: "probe" }),
		reader: () => reader,
		configure: () => {},
		page: () => store.current(),
		snapshotOf: () => reader.snapshot(),
		snapshot: () => reader.snapshot(),
		openPage: async (scope) => store.open(scope, "", ""),
	};
	const handler = createReviewHandler({ store, current, base: REVIEW_MOUNT });
	const mount = await testMountSource()({
		session: "review-browser",
		prefix: REVIEW_MOUNT,
		handler,
		maxBodyBytes: 256 * 1024,
	});
	if (mount.kind !== "mounted") throw new Error("the review page did not mount");
	return {
		url: `${mount.mount.origin}${REVIEW_MOUNT}/new`,
		move: () => {
			fingerprint = "rev-2";
		},
		reshape: (next: SnapshotOptions) => {
			shape = next;
			fingerprint = "rev-2";
		},
		rev: () => fingerprint,
		closePage: () => store.close(),
		close: () => mount.mount.release(),
	};
}

/**
 * The page's own first paint: the chrome and the diff the server rendered, in the document.
 *
 * The page is one script that reads the `#rv-data` island and restores drafts from
 * `sessionStorage` before it returns, so `load` — which waits for that script — is already the
 * readiness fact. `networkidle` added five hundred milliseconds of silence on top of it and
 * nothing else: it is Playwright's idle floor, not the page's condition.
 */
async function drawn(page: Page): Promise<void> {
	await page.waitForSelector("#rv-filter", { timeout: REVIEW_PAINT_MS });
}

/** Open the fixture's page in the suite's tab, and wait for its rail to be drawn. */
export async function openReviewPage(
	browser: TestBrowser,
	fixture: ReviewPageFixture,
	options: { stream?: boolean } = {},
): Promise<Page> {
	const page = await suiteTab(browser);
	// The explicit half of the reset the new origin gives: a fixture that ever reused a port must
	// not hand a draft to the next case, and a blocked store is not this case's failure.
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
	// Installed before the page's script runs, so the bundle that only a case opts into is the one
	// it gets. Every other suite opens a page with no stream at all, exactly as before.
	if (options.stream === true) await page.addInitScript(STREAM_STUB);
	await page.goto(fixture.url, { waitUntil: "load" });
	await drawn(page);
	return page;
}

/** Reload the tab onto the page it already has, and wait for that page to be drawn again. */
export async function reloadReview(page: Page): Promise<void> {
	await page.reload({ waitUntil: "load" });
	await drawn(page);
}

/**
 * The page's stream, stood in for: an `EventSource` that opens nothing and takes its frames from a
 * case.
 *
 * The alternative — a fixture whose handler carries a registry — would give every suite a real
 * socket from a page that is otherwise served from a string. A stub that never asks for a URL
 * crosses neither: the client's own state machine is the subject here, and the transport's route
 * is `transport/stream.test.ts`'s to prove.
 */
const STREAM_STUB = `(() => {
  const streams = [];
  globalThis.__reviewStreams = streams;
  globalThis.EventSource = function EventSource(url) {
    const listeners = [];
    this.url = url;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this.addEventListener = (name, run) => listeners.push({ name, run });
    this.close = () => { this.closed = true; };
    // What a real source does on connect, so a case can tell the chip is following a stream at all.
    this.open = () => { if (this.onopen) this.onopen({ type: "open" }); };
    this.send = (name, event) => {
      const handler = name === "message" ? this.onmessage : null;
      if (handler) handler(event);
      for (const entry of listeners) if (entry.name === name) entry.run(event);
    };
    streams.push(this);
    queueMicrotask(this.open);
  };
})();`;

/**
 * Hand one frame to every open stream, the way the socket would.
 *
 * A case pushes rather than waits, so "this landed while the box was open" is a fact the case
 * controls instead of a race it hopes for. The frame is the payload alone: the `data: …` framing is
 * the registry's, on the server, and never reaches the page.
 */
export async function pushFrame(page: Page, frame: unknown): Promise<void> {
	await page.evaluate(
		(data) => {
			const streams = (
				globalThis as unknown as {
					__reviewStreams?: ReadonlyArray<{ send?: (name: string, event: { data: string }) => void }>;
				}
			).__reviewStreams;
			for (const stream of streams ?? []) stream.send?.("message", { data });
		},
		typeof frame === "string" ? frame : JSON.stringify(frame),
	);
}

/** A browser case pays a launch, a load, and an interaction. */
export const CASE_MS = 30_000;

/**
 * One fixture and the suite's tab: the document is replaced for the case, the fixture is not kept.
 *
 * Two suites drive this page — the reading (cursor, place, spill) and the chrome (filter, switch,
 * band, wrap) — so the launch and the ownership live here rather than in either of them. The tab
 * outlives the case and `browser.close()` takes it; a case never closes it, because the next one
 * in the file would pay a fresh context for it.
 */
export async function withReviewPage(
	browser: TestBrowser,
	run: (page: Page, fixture: ReviewPageFixture) => Promise<void>,
	options: SnapshotOptions = {},
	seed: readonly SeedComment[] = [],
	live = false,
): Promise<void> {
	const fixture = await mountReviewPage(options, seed);
	const page = await openReviewPage(browser, fixture, { stream: live });
	try {
		await run(page, fixture);
	} finally {
		await fixture.close();
	}
}

/** Comment on the added line and leave the composer open with `text`. */
export async function startComment(page: Page, text: string): Promise<void> {
	await page.locator(".bf-diff-line--add .browse-diff-no").filter({ hasText: /^\d+$/ }).first().click();
	await page.locator("#rv-sel-comment").click();
	await page.locator(".rv-compose__area").fill(text);
}

/**
 * The sliver of the document a case's predicate reads, reached by name inside its own body.
 *
 * This project's TypeScript has no DOM lib — the client is a string, so nothing here ever
 * compiled against one — and a predicate handed to Playwright is serialized into the page, so
 * it cannot close over a helper. It cannot be a string either: the page answers with
 * `script-src 'self'`, and a string predicate is evaluated, which that policy refuses. Hence a
 * function per wait, and this shape for what it reads.
 */
export interface ReviewDom {
	document: {
		querySelector(selector: string): ReviewNode | null;
		querySelectorAll(selector: string): ArrayLike<ReviewNode>;
		getElementById(id: string): ReviewNode | null;
	};
	location: { hash: string };
	/** A rule as the browser computed it, for a case that proves a stylesheet rather than markup. */
	getComputedStyle(node: ReviewNode): { borderLeftWidth: string; borderTopWidth: string };
}

/** A node's box: the four edges, and the two sizes a layout case measures. */
export interface ReviewBox {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

/** One node as a predicate reads it: its box, the attributes the page marks it with, its style. */
export interface ReviewNode {
	querySelector(selector: string): ReviewNode | null;
	getAttribute(name: string): string | null;
	getBoundingClientRect(): ReviewBox;
	/** The text the row shows, which #817 asserts does *not* change when a file is marked. */
	textContent: string | null;
	/**
	 * Whether the node is out of the flow by attribute.
	 *
	 * `hidden` rather than removed: a zero count sets it, and a case that measures a row with and
	 * without its count proves the attribute beats the rule's own `display` (#817).
	 */
	hidden: boolean;
	/** Content wider than the box it was given: the clipped row a geometry case reads. */
	scrollWidth: number;
	clientWidth: number;
	offsetHeight: number;
	scrollTop: number;
	style: { getPropertyValue(name: string): string };
}
