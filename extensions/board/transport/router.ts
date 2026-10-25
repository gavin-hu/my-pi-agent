/**
 * The board page's router: one request in, one response out, and every policy the
 * served surface obeys decided here.
 *
 * The page reads. It cannot change a card, so what is left to decide is the `Host`
 * allowlist, the token in the URL, and which reads exist — a method that would write is
 * refused by the method list before a handler is reached. The guards themselves are
 * `lib/http`'s — this module only decides the order and the sentences.
 *
 * Nothing here knows what a board is. The snapshot arrives as `view()` and the document
 * as `page()`, both supplied by `page.ts`, so this file can be tested with a fake store
 * and no server.
 */

import {
	envelopeRefusal,
	eventHeaders,
	jsonError,
	jsonResponse,
	pageHeaders,
	parseRequestUrl,
	scriptHeaders,
	type ServeResponse,
} from "../../../lib/http/index.ts";
import type { BoardView } from "../../../lib/board/view.ts";
import { THEME_JS, THEME_JS_PATH } from "../../../lib/web/index.ts";
import type { PageView } from "../view/page.ts";

/**
 * The methods this surface serves: the two reads and the stream.
 *
 * `PAGE_METHODS` also carries `POST`, because a page that writes needs it. This one does
 * not, so a write is refused by the envelope — before the token is even read — and the
 * `Allow` header says the truth about what a browser can do here.
 */
const METHODS: readonly string[] = ["GET", "HEAD"];

/** Everything the router needs from the running page. */
export interface BoardRouterContext {
	/** Whether a token is this page's. */
	read: (given: string | null) => boolean;
	/** The names this server answers to. */
	hosts: () => readonly string[];
	/** The document for one tab. */
	page: (view: PageView) => Promise<string>;
	/** The client script. */
	script: string;
	/** The snapshot the page renders, and the body of `/api/board`. */
	view: () => Promise<BoardView>;
}

/**
 * Handle one request. `method`, `rawUrl`, and `headers` are the raw HTTP values.
 */
export async function handleBoardRequest(
	ctx: BoardRouterContext,
	method: string,
	rawUrl: string,
	headers: Record<string, string | string[] | undefined> = {},
): Promise<ServeResponse> {
	const envelope = envelopeRefusal({ method, headers, hosts: ctx.hosts(), allowed: METHODS });
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === "/favicon.ico") return { status: 204, headers: { "Cache-Control": "no-store" } };
	if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
	if (pathname === "/app.js") return { status: 200, headers: scriptHeaders(), body: ctx.script };

	if (!ctx.read(search.get("token"))) return jsonError(403, "Invalid or missing token.");

	if (pathname === "/api/board") return jsonResponse(200, await ctx.view());
	if (pathname === "/" || pathname === "/index.html") {
		return { status: 200, headers: pageHeaders(), body: await ctx.page(viewOf(search.get("view"))) };
	}
	if (pathname === "/events") return { status: 200, headers: eventHeaders(), stream: true };
	return jsonError(404, "That page does not exist.");
}

/** The tab a `?view=` names; anything else is the board. */
function viewOf(raw: string | null): PageView {
	return raw === "team" ? "team" : "board";
}
