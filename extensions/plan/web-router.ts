/**
 * The request router for browser plan review.
 *
 * A request is validated (method, `Host`, origin, token), matched to a route,
 * and answered with a plain {@link ServeResponse}, so every route can be tested
 * without a socket. The `/events` route is a marker: the node server in `web.ts`
 * keeps that response open as a Server-Sent Events stream.
 *
 * The token is a per-session secret carried in the page URL, and on a shared
 * review it is the only credential a reviewer has: it names the caller — the
 * role it holds, and the name it posts under — and the router refuses an
 * owner-only route for a reviewer however the request was built.
 */

import {
	envelopeRefusal,
	eventHeaders,
	jsonError,
	jsonResponse,
	pageHeaders,
	parseRequestUrl,
	postOnly,
	scriptHeaders,
	type ServeResponse,
} from "../../lib/http/index.ts";
import { THEME_JS, THEME_JS_PATH } from "../../lib/web/index.ts";
import { coerceAnnotations, type PlanAnnotation } from "./feedback.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";
import type { ReviewCaller, ReviewRole } from "./types.ts";
import type { ShareResult } from "./web-share.ts";

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
	/** Build the page data for the caller (recomputed per request). */
	page: (caller: ReviewCaller) => Promise<ReviewPageData>;
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

/**
 * Parse and validate an `{ annotations }` request body. Returns the annotations,
 * or an error response to send instead.
 */
function parseAnnotations(body: string): PlanAnnotation[] | ServeResponse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return jsonError(400, "The request body must be JSON.");
	}
	const annotations = coerceAnnotations((parsed as { annotations?: unknown } | null)?.annotations);
	if (!annotations) return jsonError(400, "The annotations are malformed.");
	return annotations;
}

/** A parsed body is either the annotations or the error response to send. */
function isResponse(value: PlanAnnotation[] | ServeResponse): value is ServeResponse {
	return !Array.isArray(value);
}

/**
 * The 403 for a route the caller's role may not use, or nothing when it may. Each
 * route keeps its own sentence, because the reason differs: a reviewer posts
 * comments, and only the owner decides.
 */
function roleOnly(caller: ReviewCaller, roles: readonly ReviewRole[], message: string): ServeResponse | undefined {
	return roles.includes(caller.role) ? undefined : jsonError(403, message);
}

/** The link id a revoke request names, or undefined when the body has none. */
function linkIdOf(body: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}
	const id = (parsed as { id?: unknown } | null)?.id;
	return typeof id === "string" && id !== "" ? id : undefined;
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
): Promise<ServeResponse> {
	const envelope = envelopeRefusal({ method, headers, hosts: ctx.hosts() });
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
	if (pathname === "/client.js") return { status: 200, headers: scriptHeaders(), body: REVIEW_CLIENT_JS };

	const token = search.get("token") ?? "";
	const caller = ctx.caller(token);
	if (caller === undefined) return jsonError(403, "Invalid or missing token.");

	if (pathname === "/" || pathname === "/index.html") {
		return { status: 200, headers: pageHeaders(), body: renderReviewPage(await ctx.page(caller)) };
	}
	if (pathname === "/events") return { status: 200, headers: eventHeaders(), stream: true };
	if (pathname === "/api/cancel") {
		// Ending the review is the owner's decision; a reviewer closes their tab.
		const refusal =
			postOnly(method, "cancel") ?? roleOnly(caller, ["owner"], "Only the plan owner can close this review.");
		if (refusal) return refusal;
		ctx.onCancel();
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/share" || pathname === "/api/share/link" || pathname === "/api/share/stop") {
		// A shared link must never be able to mint another one.
		const refusal =
			postOnly(method, "share or stop sharing") ??
			roleOnly(caller, ["owner"], "Only the plan owner can share this review.");
		if (refusal) return refusal;
		const result =
			pathname === "/api/share/stop"
				? await ctx.stopShare()
				: pathname === "/api/share/link"
					? await ctx.invite()
					: await ctx.share();
		return jsonResponse(200, { ok: true, share: result.state, svg: result.svg });
	}
	if (pathname === "/api/share/revoke") {
		const refusal =
			postOnly(method, "revoke a link") ?? roleOnly(caller, ["owner"], "Only the plan owner can revoke a link.");
		if (refusal) return refusal;
		const id = linkIdOf(body);
		if (id === undefined) return jsonError(400, "The request body must name the link's id.");
		const result = await ctx.revoke(id);
		if (!result) return jsonError(404, "That link is not shared.");
		return jsonResponse(200, { ok: true, share: result.state, svg: result.svg });
	}
	if (pathname === "/api/comment") {
		// A reviewer's whole surface: persist the comments they wrote and end
		// nothing. Only the owner's own save decides the review.
		const refusal =
			postOnly(method, "post comments") ?? roleOnly(caller, ["reviewer"], "Only a shared reviewer posts comments.");
		if (refusal) return refusal;
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations, caller);
		if (!result.ok) return jsonError(result.status, result.message);
		return jsonResponse(200, { ok: true, ...(result.author === undefined ? {} : { author: result.author }) });
	}
	if (pathname === "/api/feedback") {
		// Returning to the model is the owner's decision; a reviewer posts to
		// `/api/comment`, so this route can never settle a shared review.
		const refusal =
			postOnly(method, "save feedback") ??
			roleOnly(caller, ["owner"], "Only the plan owner saves this review; a reviewer posts comments.");
		if (refusal) return refusal;
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations, caller);
		if (!result.ok) return jsonError(result.status, result.message);
		ctx.onSaved(annotations);
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/approve") {
		// Only the owner's own page approves, and only the `exit` flow owns
		// the side effects: a reviewer token is refused whatever it posts.
		const refusal =
			postOnly(method, "approve") ?? roleOnly(caller, ["owner"], "A shared review cannot approve the plan.");
		if (refusal) return refusal;
		if (!ctx.canApprove) return jsonError(403, "This review cannot be approved from the browser.");
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations, caller);
		if (!result.ok) return jsonError(result.status, result.message);
		ctx.onApprove(annotations);
		return jsonResponse(200, { ok: true });
	}

	return jsonError(404, "That page does not exist.");
}
