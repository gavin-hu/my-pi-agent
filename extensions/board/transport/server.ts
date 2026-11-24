/**
 * The board page's mount: the prefix it holds on the session's one server, the snapshot
 * pushed to every attached tab, and the idle grace that gives the prefix back when the
 * last one leaves.
 *
 * `lib/http` owns the socket and `serve` owns the session's port, so this module owns only
 * the board's own decisions: where it answers (`BOARD_BASE`), when a frame is pushed (on a
 * watched write, on a moved bus stamp, and on the sweep for the facts no file announces), who
 * receives it, and what stops the signal.
 */

import { BOARD_BASE } from "../../../lib/workflow/page-pointer.ts";
import type { BoardWire } from "../../../lib/workflow/view.ts";
import {
	type HttpMount,
	LOOPBACK_HOSTS,
	type MountSource,
	type MountSpec,
	mintToken,
	tokenMatches,
} from "../../../lib/http/index.ts";
import type { IdleReason } from "../../../lib/http/sink.ts";
import { type ArmTimer, defaultInterval, type RepeatTimer } from "../../../lib/timer.ts";
import { createStreams } from "../../../lib/web/streams.ts";
import type { PageView } from "../view/page.ts";
import { type BoardRouterContext, handleBoardRequest } from "./router.ts";
import { defaultWatchDirs, type WatchDirs } from "./watch.ts";

/**
 * How often the page asks whether anything moved: one tick, one cheap question.
 *
 * This is the cadence a page no watch can cover has always had, and it is the cadence the
 * stamp is asked at — a tick that finds nothing changed builds nothing, so an idle page pays
 * a stat set per second and a frame per sweep.
 */
const TICK_MS = 1_000;

/**
 * How often a watched page builds a frame regardless of the stamp.
 *
 * A card's file is not the only news: a card gone unwritten is a clock, a peer's quiet or
 * gone is another extension's record, and a plan removed is a file outside this pile. None
 * of those announce themselves, so the page keeps a slow sweep over the facts no file
 * announces — and a write pushes immediately, through the watch.
 */
const SWEEP_MS = 5_000;

/** Ticks in one sweep: the count a stamp cannot answer for. */
const SWEEP_TICKS = SWEEP_MS / TICK_MS;

/**
 * The one kind of stream this page has.
 *
 * Board has no roles and no tokens — every tab sees the whole board — so the registry's record
 * exists to be counted rather than filtered, and one key names them all.
 */
const BOARD_STREAM = "board";

/** Largest request body the page accepts: a card and a note are small. */
const MAX_BODY_BYTES = 64 * 1_024;

/** What the page is built from. The lifecycle (`page.ts`) supplies all of it. */
export interface BoardServerOptions {
	/** Where the prefix comes from: the session's server, or a suite's own. */
	mount: MountSource;
	/** The Pi session asking, so the prefix lands on this session's socket. */
	session: string;
	/** The page's token; minted here when the caller has none, so the note carries one. */
	token?: string;
	page: (view: PageView) => Promise<string>;
	script: string;
	view: () => Promise<BoardWire>;
	/** Called when the page went idle: no tab ever opened, or the last one left. */
	onIdle?: (reason: IdleReason) => void;
	/** Grace after the last stream leaves; 0 or absent waits for `close()`. */
	idleMs?: number;
	/** Grace for a page no tab ever attached to; absent leaves the mount open. */
	firstIdleMs?: number;
	/**
	 * A read that failed while building a frame.
	 *
	 * A snapshot can fail for reasons the page does not control — the board directory removed
	 * or made unreadable under a running page — and a ticker nobody awaits must not turn that
	 * into an unhandled rejection in the session. The frame is dropped, the next tick tries
	 * again, and this is the one place the failure is said. Absent, the page stays quiet.
	 */
	onError?: (error: unknown) => void;
	/**
	 * The directories whose writes are news, watched while any tab is attached.
	 *
	 * Absent or empty, the page scans on {@link TICK_MS} alone. `page.ts` names the pile; this
	 * module does not know what a store is.
	 */
	dirs?: readonly string[];
	/**
	 * The bus's cheap question: a stamp that moves when a file the page draws moves.
	 *
	 * The frame is half cards and half bus — mail, a peer's state, a turn, a plan removed — and
	 * no watch over `cards/` announces the second half. So the tick asks this instead of reading
	 * the bus: a stamp that did not move builds nothing, and the sweep still covers the facts no
	 * file carries. Absent reads as "changed every tick", which is the cadence a page with no
	 * stamp has always had.
	 *
	 * Recorded after the view it describes resolves, so a build that threw asks again on the next
	 * tick rather than waiting for the sweep: a bus nobody can read must not go silent.
	 */
	stamp?: () => Promise<string>;
	/** The watch seam, so a test fires a change instead of writing a file. */
	watch?: WatchDirs;
	/** The interval seam, so a test drives the ticker instead of waiting. */
	interval?: RepeatTimer;
	/**
	 * The one-shot seam the idle grace and the watch's coalescing window are armed on, so a
	 * test fires it instead of waiting.
	 *
	 * The grace is a wall-clock timer in the product (a minute, two minutes), so a case that
	 * awaits its injected milliseconds is really betting its budget on machine load.
	 */
	timer?: ArmTimer;
	/**
	 * The hint this page's first reconnect carries, in ms; absent, `RETRY_MS`.
	 *
	 * The same seam as `timer`: a browser waits the hint out before it tries again, so a
	 * case that watches a dropped stream reach its last state would otherwise spend four
	 * seconds of its budget on the browser's clock.
	 */
	retryMs?: number;
}

/** A running page. */
export interface BoardServer {
	port: number;
	/** The URL for this page: one address, because there is one thing a page may do. */
	url: string;
	/** How many streams are open — one per attached tab — which is what `/board status` reports. */
	watchers: () => number;
	/** The signature of the last frame pushed, so a caller can tell it is live. */
	pushed: () => string;
	close: () => Promise<void>;
}

/** The page, or the reason the session's server has no prefix for it. */
export type BoardServerResult = { kind: "served"; server: BoardServer } | { kind: "refused"; reason: string };

/**
 * One frame's payload: the view the page parses.
 *
 * `data: …\n\n` is not here, because a frame has two senders and only one of them is board's —
 * the registry's fan-out frames what it broadcasts, and the one-sink attach frame below is the
 * only prefix board writes itself.
 */
const payload = (view: BoardWire): string => JSON.stringify(view);

export async function createBoardServer(options: BoardServerOptions): Promise<BoardServerResult> {
	const token = options.token ?? mintToken();
	// A plain fan-out: every tab gets every frame, and no tab's leaving decides anything here.
	const streams = createStreams({});
	const interval = options.interval ?? defaultInterval;
	/** A frame that could not be built is not sent; the next tick tries again. */
	const report = (error: unknown): void => options.onError?.(error);
	let pushed = "";
	/** The bus stamp the last frame drawn was built from; `undefined` until a frame is built. */
	let lastStamp: string | undefined;
	/** The bus's cheap question, when the caller supplied one: a page with none reads every tick. */
	const stamp = options.stamp;

	/**
	 * The frame to draw, and the stamp it was read at.
	 *
	 * The stamp is read **before** the view, and recorded only once that view resolved. A bus write
	 * that lands while the view is being read is then news rather than silence: the frame being built
	 * does not carry it, so the next tick finds the stamp it drew under moved and rebuilds. Recording
	 * after the view keeps the other half — a build that threw leaves the old stamp behind, so the
	 * next tick asks again instead of waiting for the sweep.
	 */
	const drawn = async (): Promise<BoardWire> => {
		const mark = stamp === undefined ? undefined : await stamp();
		const view = await options.view();
		if (mark !== undefined) lastStamp = mark;
		return view;
	};

	const ctx: BoardRouterContext = {
		read: (given) => tokenMatches(token, given ?? ""),
		hosts: () => LOOPBACK_HOSTS,
		page: options.page,
		script: options.script,
		view: options.view,
	};

	/**
	 * Read the board and push it when the signature moved; one read in flight at a time.
	 *
	 * With a watch, a change can land while a read is running — a bulk write is a burst of
	 * them — so the second change is folded into one more read rather than into a second
	 * frame: two reads racing would let an older frame overtake a newer one.
	 */
	let pushing = false;
	let again = false;
	const push = async (): Promise<void> => {
		if (pushing) {
			again = true;
			return;
		}
		if (streams.size() === 0) return;
		pushing = true;
		try {
			do {
				again = false;
				const view = await drawn();
				// A frame is a snapshot, so sending one that says nothing new costs the page a
				// parse and every reader a flicker. The signature is what changes.
				if (view.sig === pushed) continue;
				pushed = view.sig;
				streams.broadcast(payload(view));
			} while (again && streams.size() > 0);
		} finally {
			pushing = false;
		}
	};

	/** The prefix this page asks for: the session's server holds it, not this module. */
	const spec: Omit<MountSpec, "handler"> = {
		session: options.session,
		prefix: BOARD_BASE,
		maxBodyBytes: MAX_BODY_BYTES,
		...(options.idleMs === undefined || options.onIdle === undefined
			? {}
			: {
					idle: {
						ms: options.idleMs,
						...(options.firstIdleMs === undefined ? {} : { firstMs: options.firstIdleMs }),
						onIdle: options.onIdle,
					},
				}),
		...(options.timer === undefined ? {} : { timer: options.timer }),
		...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }),
	};
	const outcome = await options.mount({
		...spec,
		async handler(request) {
			const result = await handleBoardRequest(ctx, request.method, request.url, request.headers);
			if (!result.stream) return { result };
			return {
				result,
				openSink(sink) {
					streams.add(sink, { key: BOARD_STREAM });
					// A tab that just attached gets the current frame without waiting for a
					// card to change — otherwise a quiet board looks like a dead page.
					void drawn()
						.then((view) => {
							pushed = view.sig;
							sink.write(`data: ${payload(view)}\n\n`);
						})
						.catch(report);
					return () => {
						streams.remove(sink);
					};
				},
			};
		},
	});
	if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason };
	const mount: HttpMount = outcome.mount;

	// The watch is the page's signal and the sweep is its safety net: a pile that could not be
	// watched keeps today's one-second scan, so the page is never staler than it was.
	const dirs = options.dirs === undefined || options.dirs.length === 0 ? undefined : options.dirs;
	const handle =
		dirs === undefined
			? undefined
			: (options.watch ?? defaultWatchDirs)(dirs, () => void push().catch(report), {
					...(options.timer === undefined ? {} : { timer: options.timer }),
				});
	/**
	 * Build a frame only when the bus answers a stamp the last frame did not carry.
	 *
	 * A page nobody is reading asks nothing: a minute with no tab open costs no stat at all.
	 */
	const moved = async (): Promise<void> => {
		if (stamp === undefined || streams.size() === 0) return;
		if ((await stamp()) === lastStamp) return;
		await push();
	};
	let ticks = 0;
	const stopTicker = interval(TICK_MS, () => {
		ticks += 1;
		// No watch, no stamp, or a sweep due: this tick is a read. Otherwise the stamp decides.
		if (handle === undefined || stamp === undefined || ticks % SWEEP_TICKS === 0) {
			void push().catch(report);
			return;
		}
		void moved().catch(report);
	});
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		handle?.stop();
		stopTicker();
		// The registry ends and clears in one place, so the teardown has no loop of its own to
		// get wrong; the mount is released only once nothing is left to write to.
		streams.end();
		streams.clear();
		await mount.release();
	};

	return {
		kind: "served",
		server: {
			port: mount.port,
			url: `${mount.origin}${mount.base}/?token=${token}`,
			watchers: () => streams.size(),
			pushed: () => pushed,
			close,
		},
	};
}
