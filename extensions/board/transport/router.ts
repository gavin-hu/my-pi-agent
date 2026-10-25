/**
 * The board page's router: one request in, one response out, and every policy the
 * served surface obeys decided here.
 *
 * The page can read and it can write, so it is checked the way `plan`'s review page
 * is: a token in the URL, the `Host` allowlist, an origin check on every
 * state-changing method, and a JSON body. The guards themselves are `lib/http`'s —
 * this module only decides the order and the sentences.
 *
 * Nothing here knows what a board is. The snapshot arrives as `view()`, a write as
 * `write()`, and the document as `page()`, all supplied by `page.ts`, so this file
 * can be tested with a fake store and no server.
 */

import {
	envelopeRefusal,
	eventHeaders,
	jsonError,
	jsonResponse,
	pageHeaders,
	PAGE_METHODS,
	parseRequestUrl,
	postOnly,
	requireJsonBody,
	scriptHeaders,
	type ServeResponse,
	tokenMatches,
} from "../../../lib/http/index.ts";
import type { BoardView } from "../../../lib/board/view.ts";
import type { Card } from "../../../lib/board/card.ts";
import { THEME_JS, THEME_JS_PATH } from "../../../lib/web/index.ts";
import type { PageView } from "../view/page.ts";

/** The methods this surface serves: reads, writes, and the one deletion. */
const METHODS: readonly string[] = [...PAGE_METHODS, "DELETE"];

/** The verbs a card route accepts, in the order the page uses them. */
const CARD_VERBS = ["claim", "release", "reclaim", "move", "note", "plan"] as const;

/** One card verb. */
export type CardVerb = (typeof CARD_VERBS)[number];

/** One write the page asks for, already routed but not yet applied. */
export type PageWrite =
	| { kind: "add"; body: Record<string, unknown> }
	| { kind: "drop"; id: string }
	| { kind: CardVerb; id: string; body: Record<string, unknown> };

/** What a write did, or why it was refused with the status the page shows. */
export type PageResult = { ok: true; card: Card } | { ok: false; status: number; error: string; card?: Card };

/** Everything the router needs from the running page. */
export interface BoardRouterContext {
	/** The credential this page was minted with. */
	token: string;
	/** The names this server answers to. */
	hosts: () => readonly string[];
	/** The document for one tab. */
	page: (view: PageView) => Promise<string>;
	/** The client script. */
	script: string;
	/** The snapshot the page renders, and the body of `/api/board`. */
	view: () => Promise<BoardView>;
	/** Apply one write as the serving session. */
	write: (request: PageWrite) => Promise<PageResult>;
}

/**
 * Handle one request. `method`, `rawUrl`, and `headers` are the raw HTTP values;
 * `body` is the request body, which is only non-empty when the server caps it.
 */
export async function handleBoardRequest(
	ctx: BoardRouterContext,
	method: string,
	rawUrl: string,
	headers: Record<string, string | string[] | undefined> = {},
	body = "",
): Promise<ServeResponse> {
	const envelope = envelopeRefusal({ method, headers, hosts: ctx.hosts(), allowed: METHODS });
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === "/favicon.ico") return { status: 204, headers: { "Cache-Control": "no-store" } };
	if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
	if (pathname === "/app.js") return { status: 200, headers: scriptHeaders(), body: ctx.script };

	const refusal = tokenGuard(ctx, search.get("token"));
	if (refusal) return refusal;

	if (pathname === "/api/board") return jsonResponse(200, await ctx.view());
	if (pathname === "/" || pathname === "/index.html") {
		const view = viewOf(search.get("view"));
		return { status: 200, headers: pageHeaders(), body: await ctx.page(view) };
	}
	if (pathname === "/events") return { status: 200, headers: eventHeaders(), stream: true };

	if (pathname === "/api/cards") {
		const methodRefusal = postOnly(method, "add a card");
		if (methodRefusal) return methodRefusal;
		const jsonRefusal = requireJsonBody(headers["content-type"]);
		if (jsonRefusal) return jsonRefusal;
		const parsedBody = parseBody(body);
		if (!parsedBody) return jsonError(400, "The request body must be a JSON object.");
		return writeAnswer(await ctx.write({ kind: "add", body: parsedBody }));
	}

	const route = /^\/api\/cards\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
	if (!route) return jsonError(404, "That page does not exist.");
	const id = decodeURIComponent(route[1] ?? "");
	const verb = route[2];

	if (verb === undefined) {
		if (method.toUpperCase() !== "DELETE") return jsonError(405, "Use DELETE to drop a card.");
		return writeAnswer(await ctx.write({ kind: "drop", id }));
	}
	if (!CARD_VERBS.includes(verb as CardVerb)) return jsonError(404, "That card action does not exist.");
	const methodRefusal = postOnly(method, verb);
	if (methodRefusal) return methodRefusal;
	const jsonRefusal = requireJsonBody(headers["content-type"]);
	if (jsonRefusal) return jsonRefusal;
	const parsedBody = parseBody(body);
	if (!parsedBody) return jsonError(400, "The request body must be a JSON object.");
	return writeAnswer(await ctx.write({ kind: verb as CardVerb, id, body: parsedBody }));
}

/** The 403 for a missing or wrong token, or nothing when the caller may proceed. */
function tokenGuard(ctx: BoardRouterContext, given: string | null): ServeResponse | undefined {
	if (tokenMatches(ctx.token, given ?? "")) return undefined;
	return jsonError(403, "Invalid or missing token.");
}

/** The tab a `?view=` names; anything else is the board. */
function viewOf(raw: string | null): PageView {
	return raw === "team" ? "team" : "board";
}

/** A request body as an object, or undefined when it is not one. */
function parseBody(body: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	return parsed as Record<string, unknown>;
}

/** A write's answer: the card, or the refusal and the card it left alone. */
function writeAnswer(result: PageResult): ServeResponse {
	if (result.ok) return jsonResponse(200, { card: result.card });
	return jsonResponse(
		result.status,
		result.card === undefined ? { error: result.error } : { error: result.error, card: result.card },
	);
}
