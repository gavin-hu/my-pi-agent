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
import { createReviewStore } from "../../extensions/code-review/review/store.ts";
import { createReviewHandler } from "../../extensions/code-review/transport/router.ts";
import type { TestBrowser } from "./browser.ts";
import { testMountSource } from "./serve.ts";

/** The browser this machine has; absent means a browser suite is skipped, naming `PI_CHROME`. */
export const REVIEW_CHROME = findChrome();

/** How long a page gets to paint, or to answer after an interaction. */
export const REVIEW_PAINT_MS = 10_000;

/** The prefix the page answers under, as `serve` mounts it. */
export const REVIEW_MOUNT = "/review";

/**
 * One file: a hunk head, then `lines` context rows and one added line. With `lines` absent it
 * is three numbered rows (two context and an add) — the shape the cursor cases count on.
 */
function fileRows(rel: string, start: number, lines = 0): ReviewSnapshot["files"][number] {
	const body: DiffLine[] = [];
	if (lines > 0) {
		for (let index = 0; index < lines; index++) {
			body.push({ kind: "ctx", text: `const v${index} = ${index};`, oldNo: start + index, newNo: start + index });
		}
		body.push({ kind: "add", text: "const more = 0;", newNo: start + lines });
	} else {
		body.push(
			{ kind: "ctx", text: "const one = 1;", oldNo: start, newNo: start },
			{ kind: "ctx", text: "const two = 2;", oldNo: start + 1, newNo: start + 1 },
			{ kind: "add", text: "const three = 3;", newNo: start + 2 },
		);
	}
	return {
		rel,
		status: "M",
		add: 1,
		del: 0,
		binary: false,
		truncated: false,
		lines: [{ kind: "hunk", text: `@@ -${start},2 +${start},3 @@` }, ...body],
	};
}

/** A snapshot's shape a case may move: where a file starts, how tall it is, and how many files. */
export interface SnapshotOptions {
	/** The first line of the first file's hunk; default 1. */
	start?: number;
	/** Append a second file, so a move can cross into it. */
	second?: boolean;
	/** Context rows per file (plus the added line); absent keeps the three-row shape. */
	lines?: number;
	/** How many files; overrides `second` when given. */
	files?: number;
}

/** One snapshot of `files` files, each with a hunk and its body. */
export function reviewSnapshot(fingerprint: string, options: SnapshotOptions = {}): ReviewSnapshot {
	const start = options.start ?? 1;
	const count = options.files ?? (options.second ? 2 : 1);
	const files: ReviewSnapshot["files"] = [];
	for (let index = 0; index < count; index++) {
		const rel = options.files === undefined ? (index === 0 ? "a.ts" : "b.ts") : `f${index + 1}.ts`;
		files.push(fileRows(rel, index === 0 ? start : 40 + (index - 1) * 40, options.lines ?? 0));
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
	/** The fingerprint the reader answers with now. */
	rev(): string;
	/** Close the listener; the case owns it, the way `serve` hands one out. */
	close(): Promise<void>;
}

/**
 * Serve one review page over a stub reader and the real store and routes.
 *
 * `testMountSource()` is the server `serve` runs, so the prefix stripping, the body cap and
 * the close path are the real ones; only the diff is a fixture.
 */
export async function mountReviewPage(options: SnapshotOptions = {}): Promise<ReviewPageFixture> {
	let fingerprint = "rev-1";
	let minted = 0;
	const store = createReviewStore({ mint: () => `token${++minted}`.padEnd(32, "a"), now: () => 1 });
	const reader = {
		baseRef: async () => "main",
		snapshot: async () => ({ kind: "snapshot" as const, snapshot: reviewSnapshot(fingerprint, options) }),
	};
	const handler = createReviewHandler({
		store,
		reader,
		base: REVIEW_MOUNT,
		repo: "probe",
		root: "/tmp/probe",
		baseRef: "",
	});
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
		rev: () => fingerprint,
		close: () => mount.mount.release(),
	};
}

/** Open the fixture's page and wait for the rail, which is drawn before any script runs. */
export async function openReviewPage(browser: TestBrowser, fixture: ReviewPageFixture): Promise<Page> {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	await page.goto(fixture.url, { waitUntil: "networkidle" });
	await page.waitForSelector("#rv-filter", { timeout: REVIEW_PAINT_MS });
	return page;
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
}

/** One node as a predicate reads it: its box, the attributes the page marks it with, its style. */
export interface ReviewNode {
	querySelector(selector: string): ReviewNode | null;
	getAttribute(name: string): string | null;
	getBoundingClientRect(): { top: number; bottom: number };
	offsetHeight: number;
	scrollTop: number;
	style: { getPropertyValue(name: string): string };
}
