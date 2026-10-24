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
	eventHeaders,
	hostHeaderName,
	isAllowedHostHeader,
	jsonError,
	jsonHeaders,
	jsonResponse,
	pageHeaders,
	parseRequestUrl,
	scriptHeaders,
	type ServeResponse,
} from "../../lib/http/index.ts";
import { THEME_JS, THEME_JS_PATH } from "../../lib/web/index.ts";
import { coerceAnnotations, type PlanAnnotation } from "./feedback.ts";
import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";
import type { ReviewCaller } from "./types.ts";
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
	/** Whether the browser may approve the plan (only the `exit_plan_mode` flow). */
	canApprove: boolean;
	/** Build the page data for the caller (recomputed per request). */
	page: (caller: ReviewCaller) => Promise<ReviewPageData>;
	/** Persist the annotations as the caller and report the outcome. */
	save: (annotations: PlanAnnotation[], caller: ReviewCaller) => Promise<SaveResult>;
	/** Start sharing the review, or report why it cannot be shared. */
	share: () => Promise<ShareResult>;
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

/** Validate method and `Host`; returns an error response to send instead. */
function checkEnvelope(
	ctx: ReviewContext,
	method: string,
	headers: Record<string, string | string[] | undefined>,
): ServeResponse | undefined {
	const upper = method.toUpperCase();
	if (upper !== "GET" && upper !== "HEAD" && upper !== "POST") {
		return {
			...jsonError(405, "Only GET, HEAD, and POST are served."),
			headers: { ...jsonHeaders(), Allow: "GET, HEAD, POST" },
		};
	}
	// Fail closed: a missing or non-string Host is rejected too, not just a
	// foreign one, so the DNS-rebinding guard cannot be skipped.
	if (!isAllowedHostHeader(headers, { hosts: ctx.hosts(), required: true })) {
		return jsonError(403, "Unexpected Host header.");
	}
	return upper === "POST" ? checkOrigin(headers) : undefined;
}

/**
 * Refuse a state-changing request another site made. A browser sends `Origin`
 * on every POST and `Sec-Fetch-Site` with its own classification; a request
 * with neither is a script or a test, which has no ambient credential to abuse.
 */
function checkOrigin(headers: Record<string, string | string[] | undefined>): ServeResponse | undefined {
	const site = headers["sec-fetch-site"];
	if (typeof site === "string" && site !== "" && site !== "same-origin" && site !== "none") {
		return jsonError(403, "Cross-origin request refused.");
	}
	const origin = headers.origin;
	if (origin === undefined) return undefined;
	if (typeof origin !== "string" || origin === "") return jsonError(403, "Unexpected Origin header.");
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		return jsonError(403, "Unexpected Origin header.");
	}
	const host = headers.host;
	if (typeof host !== "string" || hostHeaderName(parsed.host) !== hostHeaderName(host)) {
		return jsonError(403, "Cross-origin request refused.");
	}
	return undefined;
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
	const envelope = checkEnvelope(ctx, method, headers);
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === "/favicon.ico") return { status: 204, headers: { "Cache-Control": "no-store" } };
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
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to cancel.");
		// Ending the review is the owner's decision; a reviewer closes their tab.
		if (caller.role !== "owner") return jsonError(403, "Only the plan owner can close this review.");
		ctx.onCancel();
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/share" || pathname === "/api/share/stop") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to share or stop sharing.");
		// A shared link must never be able to mint another one.
		if (caller.role !== "owner") return jsonError(403, "Only the plan owner can share this review.");
		const result = pathname === "/api/share" ? await ctx.share() : await ctx.stopShare();
		return jsonResponse(200, { ok: true, share: result.state, svg: result.svg });
	}
	if (pathname === "/api/comment") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to post comments.");
		// A reviewer's whole surface: persist the comments they wrote and end
		// nothing. Only the owner's own save decides the review.
		if (caller.role !== "reviewer") return jsonError(403, "Only a shared reviewer posts comments.");
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations, caller);
		if (!result.ok) return jsonError(result.status, result.message);
		return jsonResponse(200, { ok: true, ...(result.author === undefined ? {} : { author: result.author }) });
	}
	if (pathname === "/api/feedback") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to save feedback.");
		// Returning to the model is the owner's decision; a reviewer posts to
		// `/api/comment`, so this route can never settle a shared review.
		if (caller.role !== "owner")
			return jsonError(403, "Only the plan owner saves this review; a reviewer posts comments.");
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations, caller);
		if (!result.ok) return jsonError(result.status, result.message);
		ctx.onSaved(annotations);
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/approve") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to approve.");
		// Only the owner's own page approves, and only the exit_plan_mode flow owns
		// the side effects: a reviewer token is refused whatever it posts.
		if (caller.role !== "owner") return jsonError(403, "A shared review cannot approve the plan.");
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
