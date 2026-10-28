/**
 * The plan web review's fixtures: the plan and its data island, a recording router
 * context, the client-source extractors, the share routes and the LAN interfaces,
 * and the session harness the suites that open a real listener share.
 *
 * A review session owns a loopback socket, so `reviewSuite()` hands out `start` and
 * `startShared` and closes whatever they opened after every test.
 */

import { afterEach, expect } from "bun:test";
import { LOOPBACK_HOSTS } from "../../../lib/http/index.ts";
import type { RepeatTimer } from "../../../lib/timer.ts";
import { testMountSource } from "../serve.ts";
import { formatFeedback, type PlanAnnotation } from "../../../extensions/plan/feedback.ts";
import type { PlanStore, StoredPlan } from "../../../extensions/plan/plans.ts";
import { REVIEW_CLIENT_JS } from "../../../extensions/plan/web-client.ts";
import { renderReviewPage, type ReviewPageData } from "../../../extensions/plan/web-page.ts";
import { handleReviewRequest, type ReviewContext, type SaveResult } from "../../../extensions/plan/web-router.ts";
import {
	createPlanWebReview,
	type PlanReviewOptions,
	type PlanReviewSession,
	type PlanWebReviewDeps,
} from "../../../extensions/plan/web.ts";
import type { NetworkInterfaces, ShareLink } from "../../../extensions/plan/web-share.ts";

export const PLAN = "# Title\n\n## Steps\n- [ ] one\n- [ ] two\n";
export const PATH = "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md";
const RELATIVE = "~/.pi/agent/plans/a1f9c02/2026-10-14-1600-demo.md";

interface ReviewIsland {
	title: string;
	token: string;
	role: "owner" | "reviewer";
	/** The reviewer's bound name, once this link has posted. */
	author?: string;
	/** Digest of the plan text the page rendered, which keys a tab's draft. */
	rev: string;
	canApprove: boolean;
	annotations: PlanAnnotation[];
	steps: { done: number; total: number };
	outline: Array<{ id: string; line: number; level: number; text: string; changed?: boolean; removed?: number }>;
	/** Absolute start lines of the blocks that are new or edited since the previous review. */
	changed?: number[];
	/** Whether the baseline carried block digests, so `changed` means something. */
	blockMarks?: boolean;
	code: Record<string, string[]>;
	limits: { comments: number; comment: number; quote: number };
	blocks: Array<{ start: number; lines: string[] }>;
}

export function islandOf(html: string): ReviewIsland {
	const match = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error("review data island missing");
	return JSON.parse(match[1] ?? "") as ReviewIsland;
}

export const HOST = { host: "127.0.0.1:1234" };

const PAGE_DATA: ReviewPageData = {
	base: "",
	title: "T",
	blocks: [{ start: 0, end: 0, kind: "paragraph", lines: ["hello"] }],
	annotations: [],
	outline: [],
	steps: { done: 0, total: 0 },
	code: {},
	limits: { comments: 200, comment: 2000, quote: 500 },
	canApprove: true,
	role: "owner",
	token: "tok",
	rev: "rev-1",
};

/** A router context that records its callbacks and can fail a save on demand. */
export function router(overrides: Partial<ReviewContext> = {}) {
	const saved: PlanAnnotation[][] = [];
	const approved: PlanAnnotation[][] = [];
	const ownerSaves: PlanAnnotation[][] = [];
	const cancelled: number[] = [];
	let nextSave: SaveResult = { ok: true };
	const ctx: ReviewContext = {
		caller: (token) => (token === "tok" ? { role: "owner" } : undefined),
		hosts: () => [...LOOPBACK_HOSTS],
		canApprove: true,
		page: async () => PAGE_DATA,
		save: async (annotations) => {
			saved.push(annotations);
			return nextSave;
		},
		share: async () => ({
			state: {
				sharing: true,
				origin: "http://192.168.1.24:1",
				links: [{ id: "link-1", address: "192.168.1.24", url: "http://x" }],
			},
		}),
		invite: async () => ({
			state: {
				sharing: true,
				origin: "http://192.168.1.24:1",
				links: [{ id: "link-2", address: "192.168.1.24", url: "http://y" }],
			},
		}),
		revoke: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		stopShare: async () => ({ state: { sharing: false, origin: "", links: [] } }),
		onSaved: (annotations) => ownerSaves.push(annotations),
		onApprove: (annotations) => approved.push(annotations),
		onCancel: () => cancelled.push(1),
		...overrides,
	};
	return {
		ctx,
		saved,
		approved,
		ownerSaves,
		cancelled,
		setSave: (result: SaveResult) => {
			nextSave = result;
		},
	};
}

export const get = (url: string) => handleReviewRequest(router().ctx, "GET", url, HOST);
export const post = (ctx: ReviewContext, url: string, body = "") => handleReviewRequest(ctx, "POST", url, HOST, body);

export function reviewPage(overrides: Partial<ReviewPageData> = {}): string {
	return renderReviewPage({
		base: "",
		title: "Add rate limiting",
		blocks: [{ start: 0, end: 0, kind: "heading", lines: ["# Add rate limiting"] }],
		annotations: [],
		outline: [{ id: "s-0", line: 0, level: 1, text: "Add rate limiting" }],
		steps: { done: 0, total: 0 },
		code: {},
		limits: { comments: 200, comment: 2000, quote: 500 },
		canApprove: true,
		role: "owner",
		token: "secret-token",
		rev: "rev-1",
		...overrides,
	});
}

const REVIEW_ORIGIN = "http://127.0.0.1:1234/?token=t";

/**
 * The source of one function in the served client, from its `function name(` to
 * its closing brace. The page is one script, so a test that inspects one function
 * slices it here instead of keeping a regex per arity.
 */
export function clientFunction(name: string): string {
	const start = REVIEW_CLIENT_JS.indexOf(`function ${name}(`);
	if (start < 0) return "";
	const end = REVIEW_CLIENT_JS.indexOf("\n  }", start);
	return end < 0 ? "" : REVIEW_CLIENT_JS.slice(start, end + 4);
}

/**
 * The `safeHref` the page actually ships, evaluated out of the client source: a
 * string assertion cannot tell a fixed rule from a broken one.
 */
function shippedSafeHref(): (url: string, base: string) => string | null {
	return new Function(`${clientFunction("safeHref")}\nreturn safeHref;`)() as (
		url: string,
		base: string,
	) => string | null;
}

export const linkFor = (url: string): string | null => shippedSafeHref()(url, REVIEW_ORIGIN);

/** The same URL with its path replaced, for a reviewer's API call. */
export function apiOf(link: string, route: string): string {
	const url = new URL(link);
	// The link names the review's own mount (`/plan/<id>/`), so the route goes inside it
	// rather than replacing the whole path.
	url.pathname = `${url.pathname.replace(/\/+$/, "")}${route}`;
	return url.toString();
}

/** One owner action on the share surface, as the page's own buttons drive it. */
export function ownerShares(session: PlanReviewSession, route: string, body?: unknown): Promise<Response> {
	return fetch(at(session, route), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
}

/** A reviewer's comment through her own link's route. */
export function reviewerPost(link: ShareLink, author: string, comment: string): Promise<Response> {
	return fetch(apiOf(link.url, "/api/comment"), {
		method: "POST",
		headers: { "content-type": "application/json", origin: new URL(link.url).origin },
		body: JSON.stringify({ annotations: [{ anchor: 1, comment, author }] }),
	});
}

/** A machine that reports one reachable IPv4 address, as a LAN laptop does. */
export const LAN = (): NetworkInterfaces => ({
	en0: [
		{
			address: "127.0.0.1",
			netmask: "255.255.255.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: "127.0.0.1/24",
		},
	],
});

/** Read the next `data:` frame from an event stream, decoded. */
export async function nextFrame(body: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	if (!body) throw new Error("no stream body");
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	for (let read = 0; read < 40; read++) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
		const line = /^data: (.*)$/m.exec(text)?.[1];
		if (line !== undefined) {
			await reader.cancel();
			return line;
		}
	}
	await reader.cancel();
	return text;
}

/** A repeating timer a test fires by hand, so a poll tick is never a race. */
export function manualTick() {
	let fire: (() => void) | undefined;
	let stopped = false;
	const tick: RepeatTimer = (_ms, fn) => {
		fire = fn;
		return () => {
			stopped = true;
			fire = undefined;
		};
	};
	return {
		tick,
		fire: () => fire?.(),
		stopped: () => stopped,
		armed: () => fire !== undefined,
	};
}

function stored(content: string): StoredPlan {
	return { path: PATH, relativePath: RELATIVE, content, bytes: Buffer.byteLength(content, "utf-8") };
}

/** An in-memory plan store, so the session tests never touch the filesystem. */
function fakeStore(initial: string) {
	let content = initial;
	let gone = false;
	const store = {
		read: async (): Promise<StoredPlan | undefined> => (gone ? undefined : stored(content)),
		saveFeedback: async (
			_cwd: string,
			_path: string,
			annotations: PlanAnnotation[],
			options: { author?: string } = {},
		): Promise<StoredPlan> => {
			content = formatFeedback(content, annotations, options);
			return stored(content);
		},
	} as unknown as PlanStore;
	return {
		store,
		content: () => content,
		/** Rewrite the plan as another writer would, without announcing anything. */
		rewrite: (next: string) => {
			content = next;
		},
		/** Treat the plan as deleted, as a reader would see it. */
		remove: () => {
			gone = true;
		},
	};
}

/**
 * The session harness: a review served on an in-memory store, and the same review
 * with its store's writer and remover handed back, so the poll tests can play
 * another process. Both are closed after the test that opened them.
 */
export function reviewSuite() {
	const reviews: ReturnType<typeof createPlanWebReview>[] = [];

	afterEach(async () => {
		await Promise.all(reviews.map((review) => review.closeAll()));
		reviews.length = 0;
	});

	async function start(
		content = "# Plan\n\n- [ ] step\n",
		options: PlanReviewOptions = {},
		deps: Partial<PlanWebReviewDeps> = {},
	): Promise<PlanReviewSession> {
		const { store } = fakeStore(content);
		const opened: string[] = [];
		const review = createPlanWebReview(store, {
			open: (url) => opened.push(url),
			token: () => "tok",
			mount: testMountSource(),
			session: () => "s1",
			...deps,
		});
		reviews.push(review);
		const session = await review.start("/repo", stored(content), options);
		if (!session) throw new Error("the review server did not start");
		expect(opened).toEqual([session.url]);
		expect(session.url).toContain("token=tok");
		return session;
	}

	/** A started review plus its server, for the tests that drive sharing. */
	async function startShared(
		deps: Partial<PlanWebReviewDeps> = {},
		options: PlanReviewOptions = {},
		plan = "# Plan\n- [ ] one\n- [ ] two\n",
	) {
		const { store, content, rewrite, remove } = fakeStore(plan);
		const review = createPlanWebReview(store, {
			open: () => {},
			token: () => "tok",
			mount: testMountSource(),
			session: () => "s1",
			...deps,
		});
		reviews.push(review);
		const session = await review.start("/repo", stored(content()), options);
		if (!session) throw new Error("the review server did not start");
		return { review, session, content, store, rewrite, remove };
	}

	return { start, startShared };
}

/** One review route, on the page's own mount: `…/plan/<id>/api/feedback?token=…`. */
const at = (session: PlanReviewSession, path: string): string => {
	const url = new URL(session.url);
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}${path}${url.search}`;
};

export const feedbackUrl = (session: PlanReviewSession) => at(session, "/api/feedback");
export const approveUrl = (session: PlanReviewSession) => at(session, "/api/approve");
export const cancelUrl = (session: PlanReviewSession) => at(session, "/api/cancel");
export const eventsUrl = (session: PlanReviewSession) => at(session, "/events");
