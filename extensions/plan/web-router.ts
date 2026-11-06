/**
 * The request router for browser plan review.
 *
 * A request is validated (method, `Host`, origin, token, and — on a route that
 * reads a body — that the body is JSON), matched to a route in the table, and
 * answered with a plain {@link ServeResponse}, so every route can be tested
 * without a socket. The `/events` route is a marker: the node server in `web.ts` keeps
 * that response open as a Server-Sent Events stream.
 *
 * The token is a per-session secret carried in the page URL, and on a shared
 * review it is the only credential a reviewer has: it names the caller — the
 * role it holds, and the name it posts under — and the router refuses an
 * owner-only route for a reviewer however the request was built.
 *
 * The routes live by role beside this module — `web-routes-owner.ts` and
 * `web-routes-reviewer.ts` — and each is a row here: what it answers, who may call it,
 * and whether it reads a body. What a route may *not* do is compose its own guards, because
 * that is the thing a new route gets wrong: it declares its access and {@link routeRefusal}
 * decides once, in the one order the contract has.
 */

import {
	envelopeRefusal,
	eventHeaders,
	isLoopbackAddress,
	jsonError,
	pageHeaders,
	parseRequestUrl,
	postOnly,
	requireJsonBody,
	scriptHeaders,
	type ServeResponse,
} from "../../lib/http/index.ts";
import { THEME_JS, THEME_JS_PATH } from "../../lib/web/index.ts";
import { coerceAnnotations, type PlanAnnotation } from "./feedback.ts";
import type { ReviewCaller, ReviewRole } from "./types.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";
import { OWNER_ROUTES } from "./web-routes-owner.ts";
import { REVIEWER_ROUTES } from "./web-routes-reviewer.ts";
import type { ShareResult } from "./web-share.ts";

/** What an owner-only route says to a request that came from the network. */
const OFF_LOOPBACK = "This route answers only on the machine serving the review.";

/** The review script's own path, beside `THEME_JS_PATH` in the page's markup. */
export const CLIENT_JS_PATH = "/client.js";

/** What a save callback reports back. A reviewer's post reports the name it was
 * stored under, so a page created before the first write can adopt it. */
export type SaveResult = { ok: true; author?: string } | { ok: false; status: number; message: string };

/** Everything the router needs from the running session. */
export interface ReviewContext {
	/** The caller a token names, or undefined when it is not one of this session's. */
	caller: (token: string) => ReviewCaller | undefined;
	/** The host names this server answers to now, so a rebound page is refused. */
	hosts: () => readonly string[];
	/** Whether the browser may approve the plan (only the `plan` tool's `exit` flow). */
	canApprove: boolean;
	/**
	 * Build the page data for the caller and the token its request carried, so the page
	 * echoes its own credential rather than the owner's (recomputed per request).
	 */
	page: (caller: ReviewCaller, token: string) => Promise<ReviewPageData>;
	/** Persist the annotations as the caller and report the outcome. */
	save: (annotations: PlanAnnotation[], caller: ReviewCaller) => Promise<SaveResult>;
	/** Start sharing the review, or report why it cannot be shared. */
	share: () => Promise<ShareResult>;
	/** Mint one more reviewer link, so each teammate holds their own. */
	invite: () => Promise<ShareResult>;
	/** Revoke one link by id; undefined when this review does not hold it. */
	revoke: (id: string) => Promise<ShareResult | undefined>;
	/** Revoke reviewer tokens and stop accepting reviewers. */
	stopShare: () => Promise<ShareResult>;
	/** Called after the owner's save; the server resolves the session once the response has flushed. */
	onSaved: (annotations: PlanAnnotation[]) => void;
	/** Called after a successful approve; the server resolves the session once the response has flushed. */
	onApprove: (annotations: PlanAnnotation[]) => void;
	/** Called when the owner cancels; the server resolves the session once the response has flushed. */
	onCancel: () => void;
}

/** The annotations a body held and the write's own report, or the refusal to send instead. */
export type Settled =
	| { response: ServeResponse }
	| { annotations: PlanAnnotation[]; result: Extract<SaveResult, { ok: true }> };

/** One request a route may act on, after the dispatcher's guards and body read. */
export interface RouteRequest {
	/** The running session the review belongs to. */
	ctx: ReviewContext;
	/** The role and the name the token gave the caller. */
	caller: ReviewCaller;
	/** The raw body, for the one route that names a link rather than annotations. */
	body: string;
	/**
	 * Parse the body as annotations and save them as the caller, or report the refusal.
	 *
	 * A route must not read a body itself: the order — parse, refuse a malformed one, then
	 * save — is what keeps a bad request from reaching the store, so it is the dispatcher's
	 * one settle, reachable from the routes on both sides of the role split.
	 */
	settle: () => Promise<Settled>;
}

/** One route the review serves behind its token. */
export interface ReviewRoute {
	/** The exact path this route answers. */
	path: string;
	/** The verb, as a 405 phrases it: `Use POST to <phrase>.` */
	phrase: string;
	/** The role that may call it. An owner's route answers on this machine alone. */
	access: ReviewRole;
	/** What a caller of another role is told. */
	refusal: string;
	/** Whether the route reads a JSON body, so anything else is a 415. */
	body: "json" | "none";
	/** What happens once the guards have passed. */
	run(request: RouteRequest): Promise<ServeResponse>;
}

/** Every route behind the token: the owner's, then the reviewer's one. */
export const REVIEW_ROUTES: readonly ReviewRoute[] = [...OWNER_ROUTES, ...REVIEWER_ROUTES];

/**
 * Parse the body and save it as the caller, or report the refusal to send instead.
 *
 * Three routes persist annotations and differ only in what they do after the write; the
 * order — parse, refuse a malformed body, then save — is what keeps a bad request from
 * reaching the store, so it lives here once.
 */
async function settleAnnotations(ctx: ReviewContext, caller: ReviewCaller, body: string): Promise<Settled> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return { response: jsonError(400, "The request body must be JSON.") };
	}
	const annotations = coerceAnnotations((parsed as { annotations?: unknown } | null)?.annotations);
	if (!annotations) return { response: jsonError(400, "The annotations are malformed.") };
	const result = await ctx.save(annotations, caller);
	if (!result.ok) return { response: jsonError(result.status, result.message) };
	return { annotations, result };
}

/** The 403 for a route the caller's role may not use, or nothing when it may. */
function roleOnly(caller: ReviewCaller, access: ReviewRole, message: string): ServeResponse | undefined {
	return caller.role === access ? undefined : jsonError(403, message);
}

/**
 * The refusal for a route, or nothing when the request may run it: method, then body type,
 * then role, then — on an owner's route — that the request came from this machine.
 *
 * The order is the whole contract: a form-encoded GET is refused as a method before its body
 * is ever read, a body that is not JSON never reaches the parser, and a reviewer is refused
 * as a role before the review's own files are touched. Loopback follows from access, because
 * an owner-only route is exactly the one that answers on the machine serving the review: a
 * shared link is a reviewer's link whatever token it carries, so the peer address — not
 * `Host`, which the client chooses — decides whether approve, cancel, save, revoke, and the
 * share controls are reachable at all.
 */
function routeRefusal(
	route: ReviewRoute,
	method: string,
	contentType: string | string[] | undefined,
	caller: ReviewCaller,
	offLoopback: boolean,
): ServeResponse | undefined {
	return (
		postOnly(method, route.phrase) ??
		(route.body === "json" ? requireJsonBody(contentType) : undefined) ??
		roleOnly(caller, route.access, route.refusal) ??
		(route.access === "owner" && offLoopback ? jsonError(403, OFF_LOOPBACK) : undefined)
	);
}

/**
 * Handle one request. `method`, `rawUrl`, and `headers` are the raw HTTP
 * values; `body` is the request body for a POST.
 */
export async function handleReviewRequest(
	ctx: ReviewContext,
	method: string,
	rawUrl: string,
	headers: Record<string, string | string[] | undefined> = {},
	body = "",
	remoteAddress?: string,
): Promise<ServeResponse> {
	const envelope = envelopeRefusal({ method, headers, hosts: ctx.hosts() });
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
	if (pathname === CLIENT_JS_PATH) return { status: 200, headers: scriptHeaders(), body: REVIEW_CLIENT_JS };

	const token = search.get("token") ?? "";
	const caller = ctx.caller(token);
	if (caller === undefined) return jsonError(403, "Invalid or missing token.");

	// The page and its stream are the same for either role: a reviewer reads the plan she was
	// invited to, and the island she is given is built for her role — and for her own token,
	// which is the only credential her page will echo back.
	if (pathname === "/" || pathname === "/index.html") {
		return { status: 200, headers: pageHeaders(), body: renderReviewPage(await ctx.page(caller, token)) };
	}
	if (pathname === "/events") return { status: 200, headers: eventHeaders(), stream: true };

	const route = REVIEW_ROUTES.find((candidate) => candidate.path === pathname);
	if (!route) return jsonError(404, "That page does not exist.");
	const refusal = routeRefusal(route, method, headers["content-type"], caller, !isLoopbackAddress(remoteAddress));
	if (refusal) return refusal;
	return route.run({ ctx, caller, body, settle: () => settleAnnotations(ctx, caller, body) });
}
