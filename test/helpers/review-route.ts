/**
 * The stage a review-route suite drives: a loopback request, the reply it answered, and a
 * page over a stub reader.
 *
 * Two suites need it — the routes' own, and the whole-file view's — and the reader is a
 * fixture either way: what a case decides is an answer the routes give, so the snapshot and
 * the file text are values here rather than a repository. The store is the real one, so a
 * refusal leaves the state a case can read.
 */

import type { ReviewReader, ReviewSnapshot } from "../../extensions/code-review/git/diff.ts";
import type { ReviewCurrent } from "../../extensions/code-review/review/current.ts";
import {
	createReviewStore,
	NO_PAGE,
	type ReviewComment,
	type ReviewStore,
} from "../../extensions/code-review/review/store.ts";
import type { ReviewScope } from "../../extensions/code-review/scope.ts";
import { createReviewHandler } from "../../extensions/code-review/transport/router.ts";
import type { LoopbackHandler, LoopbackReply, LoopbackRequest, ServeResponse } from "../../lib/http/index.ts";

/** The loopback headers every case sends, unless it is testing the envelope. */
const LOCAL = { host: "127.0.0.1:4781" };

/** One request as the loopback server hands it to a mounted handler. */
export function request(
	method: string,
	url: string,
	body?: unknown,
	headers: Record<string, string> = {},
): LoopbackRequest {
	return {
		method,
		url,
		headers: {
			...LOCAL,
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...headers,
		},
		body: body === undefined ? "" : JSON.stringify(body),
		remoteAddress: "127.0.0.1",
	};
}

/** The response one request answered. */
export async function reply(handler: LoopbackHandler, req: LoopbackRequest): Promise<ServeResponse> {
	const answered = (await handler(req)) as LoopbackReply;
	return answered.result;
}

/** One listed file, with the fields a case does not name at their quiet defaults. */
export type StubFile = Omit<ReviewSnapshot["files"][number], "rel"> & { rel: string };

/** What a stage is built from. */
export interface ReviewRouteOptions {
	/** The files the stub snapshot lists; one changed `a.ts` by default. */
	files?: ReviewSnapshot["files"];
	/** The stub's whole-file answer for a path; one context line for any path by default. */
	text?: ReviewReader["text"];
	/** The checkout the handler reports; `/tmp/repo` by default. */
	place?: { root: string; repo: string };
	/** The page opened before the case runs; `base` by default, `undefined` for none. */
	scope?: ReviewScope | undefined;
}

/** A handler, its store, and the snapshot a case can move. */
export function reviewRoute(options: ReviewRouteOptions = {}) {
	const state = { rev: "rev-1" };
	const files = options.files ?? [
		{
			rel: "a.ts",
			status: "M",
			add: 1,
			del: 1,
			binary: false,
			truncated: false,
			lines: [
				{ kind: "hunk", text: "@@ -1 +1 @@" },
				{ kind: "del", text: "old", oldNo: 1 },
				{ kind: "add", text: "new", newNo: 1 },
			],
		},
	];
	const snapshot = (): ReviewSnapshot => ({
		scope: "base",
		base: "main",
		label: "main...HEAD",
		files,
		omitted: 0,
		insertions: 1,
		deletions: 1,
		fingerprint: state.rev,
	});
	const reader: ReviewReader = {
		baseRef: async () => "main",
		text:
			options.text ??
			(async () => ({
				kind: "text",
				lines: [{ kind: "ctx", text: "const a = 1;", oldNo: 1, newNo: 1 }],
				binary: false,
				truncated: false,
			})),
		snapshot: async () => ({ kind: "snapshot", snapshot: snapshot() }),
	};
	const store = createStoreSlot();
	const current = currentOf(store, reader, options.place ?? { root: "/tmp/repo", repo: "repo" });
	const sent: Array<ReadonlyArray<ReviewComment>> = [];
	const handler = createReviewHandler({
		store,
		current,
		base: "/review",
		onSent: (comments) => sent.push(comments),
	});
	const scope = "scope" in options ? options.scope : "base";
	if (scope !== undefined) store.open(scope, "", "");
	return { state, store, handler, sent, snapshot, reader };
}

/** The seam the handler reads, over the stub reader and the real store. */
function currentOf(store: ReviewStore, reader: ReviewReader, place: { root: string; repo: string }): ReviewCurrent {
	return {
		place: () => place,
		reader: () => reader,
		configure: () => {},
		page: () => store.current(),
		snapshotOf: (page) => reader.snapshot(page.scope, page.base),
		async snapshot() {
			const page = store.current();
			return page === undefined ? { kind: "failed", message: NO_PAGE } : reader.snapshot(page.scope, page.base);
		},
		openPage: async (scope) => store.open(scope, "", ""),
	};
}

/** A store a case mints predictable tokens into, so a write can name one. */
function createStoreSlot(): ReviewStore {
	let token = 0;
	return createReviewStore({ mint: () => `tok-${++token}`, now: () => 1 });
}

/** The token the page was served with, read from the store it minted. */
export function pageToken(store: ReviewStore): string {
	const page = store.current();
	if (page === undefined) throw new Error("the page was not opened");
	return page.token;
}

/**
 * Open the page over a stage and hand back the token it was served with.
 *
 * The two suites split by capability — what the routes read, and what a write does — and both
 * need the page the other's cases leave behind, so the opening is one body here.
 */
export async function openedPage(harnessed: ReturnType<typeof reviewRoute>): Promise<string> {
	await reply(harnessed.handler, request("GET", "/new"));
	return pageToken(harnessed.store);
}

/**
 * One changed file drawing a single added line.
 *
 * The default stage is one such file; a case that needs a second, or a file a focused page does
 * not draw, builds it from this rather than repeating the shape.
 */
export function stubFile(rel: string, lines = 1): ReviewSnapshot["files"][number] {
	return {
		rel,
		status: "M",
		add: lines,
		del: 0,
		binary: false,
		truncated: false,
		lines: [
			{ kind: "hunk", text: `@@ -1,${lines} +1,${lines} @@` },
			...Array.from({ length: lines }, (_unused, index) => ({
				kind: "add" as const,
				text: `// ${rel} ${index + 1}`,
				newNo: index + 1,
			})),
		],
	};
}
