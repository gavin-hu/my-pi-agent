/**
 * The board page's mount: the prefix it holds on the session's one server, the snapshot
 * pushed to every attached tab, and the idle grace that gives the prefix back when the
 * last one leaves.
 *
 * `lib/http` owns the socket and `serve` owns the session's port, so this module owns only
 * the board's own decisions: where it answers (`BOARD_BASE`), when a frame is pushed (only
 * when a card's revision moved), who receives it, and what stops the ticker.
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

/** How often the page is offered a frame; a frame is sent only when the signature moved. */
const PUSH_MS = 1_000;

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
	/** The interval seam, so a test drives the ticker instead of waiting. */
	interval?: RepeatTimer;
	/**
	 * The one-shot seam the idle grace is armed on, so a test fires it instead of waiting.
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

	const push = async (): Promise<void> => {
		if (clients.size === 0) return;
		const view = await options.view();
		// A frame is a snapshot, so sending one that says nothing new costs the page a
		// parse and every reader a flicker. The signature is what changes.
		if (view.sig === pushed) return;
		pushed = view.sig;
		const frame = `data: ${JSON.stringify(view)}\n\n`;
		for (const sink of clients) sink.write(frame);
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

	const stopTicker = interval(PUSH_MS, () => void push().catch(report));
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
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
