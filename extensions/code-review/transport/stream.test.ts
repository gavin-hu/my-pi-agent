/**
 * The review's live stream: the route a tab follows, the frames a write sends to every tab, and
 * the grace that ends the review when the last one leaves.
 *
 * The page is driven as `serve` drives it — the registry is attached through `openSink` on a real
 * reply, the way a browser's `EventSource` lands — so a case asserts what a tab would receive
 * rather than what a mock was told. The timer and the grace are injected, because "the tab has
 * been gone for a second and a half" is a fact a case fires rather than waits for.
 */

import { describe, expect, test } from "bun:test";
import type {
	EventSink,
	HttpMount,
	LoopbackHandler,
	LoopbackReply,
	MountOutcome,
	MountSpec,
} from "../../../lib/http/index.ts";
import type { ArmTimer } from "../../../lib/timer.ts";
import { comparisonOf } from "../../../test/helpers/review-scope.ts";
import { createReviewStore, type ReviewComment, type ReviewStore } from "../review/store.ts";

import type { ReviewCurrent } from "../review/current.ts";
import type { ReviewReader } from "../git/diff.ts";
import type { ReviewSnapshot } from "../git/diff.ts";
import { createReviewPage, type ReviewServer } from "./server.ts";
import { request } from "../../../test/helpers/review-route.ts";

/** One frame's payload: the registry writes `data: …\n\n`, and the page parses what is between. */
function frameOf(raw: string | undefined): unknown {
	return JSON.parse((raw ?? "").replace(/^data: /, "").trim());
}

/** A tab: the frames it was sent, and the frames it was closed with. */
function tab(): { sink: EventSink; frames: string[]; closed: string[] } {
	const frames: string[] = [];
	const closed: string[] = [];
	return {
		frames,
		closed,
		sink: {
			write: (frame) => {
				frames.push(frame);
			},
			end: (frame) => {
				closed.push(frame ?? "");
			},
		},
	};
}

/** The timer a case fires by hand: how many graces it armed, and the callback of the last one. */
function timer(): { arm: ArmTimer; armed: number[]; cancel: number; fire: () => void } {
	const pending: Array<() => void> = [];
	const armed: number[] = [];
	const state = {
		armed,
		cancel: 0,
		fire: () => {
			const run = pending.shift();
			run?.();
		},
		arm: ((ms: number, run: () => void) => {
			armed.push(ms);
			pending.push(run);
			return () => {
				state.cancel += 1;
			};
		}) as ArmTimer,
	};
	return state;
}

/** One changed file, and a snapshot whose fingerprint a case can move. */
function readerOf(state: { rev: string }): ReviewReader {
	const snapshot = (): ReviewSnapshot => ({
		scope: comparisonOf("branch"),
		label: "main...HEAD",
		files: [
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
		],
		omitted: 0,
		insertions: 1,
		deletions: 1,
		fingerprint: state.rev,
	});
	return {
		baseRef: async () => ({ kind: "ref", ref: "main" }),
		text: async () => ({ kind: "text", lines: [], binary: false, truncated: false }),
		snapshot: async () => ({ kind: "snapshot", snapshot: snapshot() }),
	};
}

/** The mount, keeping the handler so a case subscribes the way a browser does. */
function fakeMount() {
	let handler: LoopbackHandler | undefined;
	let releases = 0;
	const source = async (spec: MountSpec): Promise<MountOutcome> => {
		handler = spec.handler;
		const mount: HttpMount = {
			base: spec.prefix,
			origin: "http://127.0.0.1:9",
			port: 9,
			release: async () => {
				releases += 1;
			},
			share: async () => undefined,
			unshare: async () => {},
		};
		return { kind: "mounted", mount };
	};
	return {
		source,
		handler: (): LoopbackHandler => {
			if (handler === undefined) throw new Error("the page mounted nothing");
			return handler;
		},
		releases: () => releases,
	};
}

/** A served page over a fake mount, its store and token, and the timer a case drives. */
async function harness(options: { schedule?: ArmTimer; onAbandoned?: () => void } = {}) {
	const state = { rev: "rev-1" };
	const store: ReviewStore = createReviewStore({ mint: () => "tok-1", now: () => 1 });
	const reader = readerOf(state);
	const current: ReviewCurrent = {
		place: () => ({ root: "/tmp/repo", repo: "repo" }),
		reader: () => reader,
		page: () => store.current(),
		snapshotOf: (page) => reader.snapshot(page.scope),
		async snapshot() {
			const page = store.current();
			return page === undefined ? { kind: "failed" as const, message: "no page" } : reader.snapshot(page.scope);
		},
		openPage: async (scope, preset) => store.open(scope, preset),
	};
	const sent: Array<ReadonlyArray<ReviewComment>> = [];
	const mount = fakeMount();
	const started = await createReviewPage({
		store,
		current,
		session: "s1",
		mount: mount.source,
		onSent: (comments) => sent.push(comments),
		...(options.schedule === undefined ? {} : { schedule: options.schedule }),
		...(options.onAbandoned === undefined ? {} : { onAbandoned: options.onAbandoned }),
	});
	if (started.kind !== "page") throw new Error(started.reason);
	const page: ReviewServer = started.page;
	store.open(comparisonOf("branch"), "branch");

	/** Subscribe the way a browser does: the stream route, then `openSink`. */
	const attach = async (token?: string): Promise<{ tab: ReturnType<typeof tab>; detach: () => void }> => {
		const held = store.current();
		const answer = (await mount.handler()(
			request("GET", `/events?token=${token ?? held?.token ?? ""}`),
		)) as LoopbackReply;
		if (answer.result.status !== 200) throw new Error(`the stream was refused: ${answer.result.status}`);
		expect(answer.result.stream).toBe(true);
		if (answer.openSink === undefined) throw new Error("the stream answered no sink");
		const opened = tab();
		const detach = answer.openSink(opened.sink);
		return { tab: opened, detach };
	};
	return {
		page,
		store,
		mount,
		sent,
		state,
		attach,
		handler: mount.handler,
		token: (): string => store.current()?.token ?? "",
	};
}

describe("the page's stream", () => {
	test("refuses a caller without the page's token, and a method it does not serve", async () => {
		const page = await harness();
		const wrong = (await page.handler()(request("GET", "/events?token=nope"))) as LoopbackReply;
		expect(wrong.result.status).toBe(403);
		const missing = (await page.handler()(request("GET", "/events"))) as LoopbackReply;
		expect(missing.result.status).toBe(403);
		const post = (await page.handler()(request("POST", `/events?token=${page.token()}`, {}))) as LoopbackReply;
		expect(post.result.status).toBe(405);
	});

	test("answers a stream the tab can attach to, and a detached tab stops being written to", async () => {
		const page = await harness();
		const opened = (await page.handler()(request("GET", `/events?token=${page.token()}`))) as LoopbackReply;
		expect(opened.result.status).toBe(200);
		expect(opened.result.headers["Content-Type"]).toContain("text/event-stream");
		const gone = tab();
		const kept = await page.attach();
		const detach = opened.openSink?.(gone.sink);
		if (detach === undefined) throw new Error("the stream answered no detach");
		detach();

		await page.handler()(
			request("POST", "/api/comment", {
				token: page.token(),
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		);
		// The tab that left is not written to again, and the one that stayed is told once.
		expect(gone.frames).toEqual([]);
		expect(kept.tab.frames).toHaveLength(1);
	});

	test("a landed write reaches every open tab, and a stale one warns them all", async () => {
		const page = await harness();
		const first = await page.attach();
		const second = await page.attach();

		const wrote = (await page.handler()(
			request("POST", "/api/comment", {
				token: page.token(),
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "hi" },
			}),
		)) as LoopbackReply;
		expect(wrote.result.status).toBe(200);
		// The writer's answer and the frame carry the same review, so a tab repaints from either.
		expect(first.tab.frames).toHaveLength(1);
		expect(second.tab.frames).toHaveLength(1);
		expect(frameOf(first.tab.frames[0])).toMatchObject({
			review: { comments: [expect.objectContaining({ body: "hi" })] },
		});

		// The tree moved: one tab writes against the diff it drew and is refused, and the news is
		// for both tabs rather than only for the one that found out.
		page.state.rev = "rev-2";
		const stale = (await page.handler()(
			request("POST", "/api/comment", {
				token: page.token(),
				rev: "rev-1",
				comment: { rel: "a.ts", line: 1, side: "new", body: "again" },
			}),
		)) as LoopbackReply;
		expect(stale.result.status).toBe(409);
		expect(frameOf(first.tab.frames[1])).toEqual({ moved: true });
		expect(frameOf(second.tab.frames[1])).toEqual({ moved: true });
	});

	test("the last tab leaving arms the grace, and firing it ends the review", async () => {
		const clock = timer();
		const abandoned: number[] = [];
		const page = await harness({ schedule: clock.arm, onAbandoned: () => abandoned.push(1) });
		const opened = await page.attach();
		opened.detach();

		expect(clock.armed).toEqual([1500]);
		expect(abandoned).toEqual([]);
		clock.fire();
		expect(abandoned).toEqual([1]);
	});

	test("a tab that comes back inside the grace is not a departure", async () => {
		const clock = timer();
		const abandoned: number[] = [];
		const page = await harness({ schedule: clock.arm, onAbandoned: () => abandoned.push(1) });
		const first = await page.attach();
		first.detach();
		// A reload: the page attaches again before the grace runs out, and the drop stands down.
		await page.attach();

		expect(clock.cancel).toBe(1);
		clock.fire();
		expect(abandoned).toEqual([]);
	});

	test("closing ends the streams with a frame before it releases the prefix, and arms nothing", async () => {
		const clock = timer();
		const page = await harness({ schedule: clock.arm, onAbandoned: () => {} });
		const opened = await page.attach();

		await page.page.close();

		// The reader is told why the page stopped updating, rather than finding the socket gone.
		expect(opened.tab.closed).toEqual(["data: closed\n\n"]);
		expect(page.mount.releases()).toBe(1);
		// A page already closing settles, so clearing its streams arms no grace and ends no review.
		expect(clock.armed).toEqual([]);
	});
});
