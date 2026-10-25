/**
 * The board page's server: one loopback listener, the snapshot pushed to every
 * attached tab, and the idle grace that closes the page when the last one leaves.
 *
 * `lib/http` owns the socket — binding, the body cap, the SSE head, and the
 * idempotent close — so this module owns only the board's own decisions: when a
 * frame is pushed (only when a card's revision moved), who receives it, and what
 * stops the ticker.
 */

import {
	type EventSink,
	LOOPBACK_HOSTS,
	type LoopbackServer,
	mintToken,
	serveLoopback,
	tokenMatches,
} from "../../../lib/http/index.ts";
import { defaultInterval, type RepeatTimer } from "../../../lib/timer.ts";
import type { BoardView } from "../../../lib/board/view.ts";
import type { PageView } from "../view/page.ts";
import { type BoardRouterContext, handleBoardRequest, type PageResult, type PageWrite } from "./router.ts";

/** How often the page is offered a frame; a frame is sent only when the signature moved. */
export const PUSH_MS = 1_000;

/** Largest request body the page accepts: a card and a note are small. */
export const MAX_BODY_BYTES = 64 * 1_024;

/** What the page is built from. The lifecycle (`page.ts`) supplies all of it. */
export interface BoardServerOptions {
	/** Ports tried in order: the session's remembered port, then an OS-chosen one. */
	ports: readonly number[];
	/** Mint a token here, or reuse the one a restart kept. */
	token?: string;
	page: (view: PageView) => Promise<string>;
	script: string;
	view: () => Promise<BoardView>;
	write: (request: PageWrite) => Promise<PageResult>;
	/** Called when the last tab has been gone for the grace period. */
	onIdle?: () => void;
	/** Grace after the last stream leaves; 0 or absent waits for `close()`. */
	idleMs?: number;
	/** The interval seam, so a test drives the ticker instead of waiting. */
	interval?: RepeatTimer;
}

/** A running page. */
export interface BoardServer {
	port: number;
	/** The URL to open, token included. */
	url: string;
	/** The signature of the last frame pushed, so a caller can tell it is live. */
	pushed: () => string;
	close: () => Promise<void>;
}

export async function createBoardServer(options: BoardServerOptions): Promise<BoardServer> {
	const token = options.token ?? mintToken();
	const clients = new Set<EventSink>();
	const interval = options.interval ?? defaultInterval;
	let pushed = "";

	const ctx: BoardRouterContext = {
		// One credential today: the page's own. The view token a teammate would carry is
		// the page lifecycle's to mint, and this is where it becomes an authority.
		authority: (given) => (tokenMatches(token, given ?? "") ? "write" : undefined),
		hosts: () => LOOPBACK_HOSTS,
		page: options.page,
		script: options.script,
		view: options.view,
		write: options.write,
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

	const server: LoopbackServer = await serveLoopback({
		ports: options.ports,
		maxBodyBytes: MAX_BODY_BYTES,
		...(options.idleMs === undefined || options.onIdle === undefined
			? {}
			: { idle: { ms: options.idleMs, onIdle: options.onIdle } }),
		async handler(request) {
			const result = await handleBoardRequest(ctx, request.method, request.url, request.headers, request.body);
			if (!result.stream) return { result };
			return {
				result,
				openSink(sink) {
					clients.add(sink);
					// A tab that just attached gets the current frame without waiting for a
					// card to change — otherwise a quiet board looks like a dead page.
					void options.view().then((view) => {
						pushed = view.sig;
						sink.write(`data: ${JSON.stringify(view)}\n\n`);
					});
					return () => {
						clients.delete(sink);
					};
				},
			};
		},
	});

	const stopTicker = interval(PUSH_MS, () => void push());
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		stopTicker();
		for (const sink of clients) sink.end();
		clients.clear();
		await server.close();
	};

	return {
		port: server.port,
		url: `http://127.0.0.1:${server.port}/?token=${token}`,
		pushed: () => pushed,
		close,
	};
}
