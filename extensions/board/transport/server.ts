/**
 * The board page's mount: the prefix it holds on the session's one server, the snapshot
 * pushed to every attached tab, and the idle grace that gives the prefix back when the
 * last one leaves.
 *
 * `lib/http` owns the socket and `serve` owns the session's port, so this module owns only
 * the board's own decisions: where it answers (`BOARD_BASE`), when a frame is pushed (on a
 * watched write, and on the sweep for the facts no file announces), who receives it, and
 * what stops the signal.
 */

import { BOARD_BASE } from "../../../lib/board/page-pointer.ts";
import type { BoardView } from "../../../lib/board/view.ts";
import {
	type EventSink,
	type HttpMount,
	LOOPBACK_HOSTS,
	type MountSource,
	type MountSpec,
	mintToken,
	tokenMatches,
} from "../../../lib/http/index.ts";
import type { IdleReason } from "../../../lib/http/sink.ts";
import { type ArmTimer, defaultInterval, type RepeatTimer } from "../../../lib/timer.ts";
import type { PageView } from "../view/page.ts";
import { type BoardRouterContext, handleBoardRequest } from "./router.ts";
import { defaultWatchDirs, type WatchDirs } from "./watch.ts";

/**
 * How often the page reads the board when no watch could be armed: today's cadence, kept
 * as the fallback for a pile that cannot be watched at all.
 */
const POLL_MS = 1_000;

/**
 * How often a watched page reads the board anyway.
 *
 * A card's file is not the only news: a card gone unwritten is a clock, a peer's quiet or
 * gone is another extension's record, and a plan removed is a file outside this pile. None
 * of those announce themselves, so the page keeps a slow sweep over the facts no file
 * announces — and a write pushes immediately, through the watch.
 */
const SWEEP_MS = 5_000;

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
	view: () => Promise<BoardView>;
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
	 * Absent or empty, the page scans on `POLL_MS` alone. `page.ts` names the pile; this
	 * module does not know what a store is.
	 */
	dirs?: readonly string[];
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
}

/** A running page. */
export interface BoardServer {
	port: number;
	/** The URL for this page: one address, because there is one thing a page may do. */
	url: string;
	/** How many tabs are attached, which is what `/board status` reports. */
	watchers: () => number;
	/** The signature of the last frame pushed, so a caller can tell it is live. */
	pushed: () => string;
	close: () => Promise<void>;
}

/** The page, or the reason the session's server has no prefix for it. */
export type BoardServerResult = { kind: "served"; server: BoardServer } | { kind: "refused"; reason: string };

export async function createBoardServer(options: BoardServerOptions): Promise<BoardServerResult> {
	const token = options.token ?? mintToken();
	const clients = new Set<EventSink>();
	const interval = options.interval ?? defaultInterval;
	/** A frame that could not be built is not sent; the next tick tries again. */
	const report = (error: unknown): void => options.onError?.(error);
	let pushed = "";

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
		if (clients.size === 0) return;
		pushing = true;
		try {
			do {
				again = false;
				const view = await options.view();
				// A frame is a snapshot, so sending one that says nothing new costs the page a
				// parse and every reader a flicker. The signature is what changes.
				if (view.sig === pushed) continue;
				pushed = view.sig;
				const frame = `data: ${JSON.stringify(view)}\n\n`;
				for (const sink of clients) sink.write(frame);
			} while (again && clients.size > 0);
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
	};
	const outcome = await options.mount({
		...spec,
		async handler(request) {
			const result = await handleBoardRequest(ctx, request.method, request.url, request.headers);
			if (!result.stream) return { result };
			return {
				result,
				openSink(sink) {
					clients.add(sink);
					// A tab that just attached gets the current frame without waiting for a
					// card to change — otherwise a quiet board looks like a dead page.
					void options
						.view()
						.then((view) => {
							pushed = view.sig;
							sink.write(`data: ${JSON.stringify(view)}\n\n`);
						})
						.catch(report);
					return () => {
						clients.delete(sink);
					};
				},
			};
		},
	});
	if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason };
	const mount: HttpMount = outcome.mount;

	// The watch is the page's signal and the sweep is its safety net: a pile that could not
	// be watched keeps today's one-second scan, so the page is never staler than it was.
	const dirs = options.dirs === undefined || options.dirs.length === 0 ? undefined : options.dirs;
	const handle =
		dirs === undefined
			? undefined
			: (options.watch ?? defaultWatchDirs)(dirs, () => void push().catch(report), {
					...(options.timer === undefined ? {} : { timer: options.timer }),
				});
	const stopTicker = interval(handle === undefined ? POLL_MS : SWEEP_MS, () => void push().catch(report));
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		handle?.stop();
		stopTicker();
		for (const sink of clients) sink.end();
		clients.clear();
		await mount.release();
	};

	return {
		kind: "served",
		server: {
			port: mount.port,
			url: `${mount.origin}${mount.base}/?token=${token}`,
			watchers: () => clients.size,
			pushed: () => pushed,
			close,
		},
	};
}
