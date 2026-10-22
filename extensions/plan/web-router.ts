/**
 * The request router for browser plan review.
 *
 * A request is validated (method, `Host`, per-session token), matched to a
 * route, and answered with a plain {@link ServeResponse}, so every route can be
 * tested without a socket. The `/events` route is a marker: the node server in
 * `web.ts` keeps that response open as a Server-Sent Events stream used only to
 * notice when the browser tab is gone.
 *
 * The token is a per-session secret carried in the page URL. It is not an
 * authentication system — the server is loopback-only — but it stops another
 * local page from driving the session.
 */

import {
	eventHeaders,
	isLocalHostHeader,
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

/** What a save callback reports back. */
export type SaveResult = { ok: true } | { ok: false; status: number; message: string };

/** Everything the router needs from the running session. */
export interface ReviewContext {
	/** Per-session secret required on the page, event stream, and API routes. */
	token: string;
	/** Whether the browser may approve the plan (only the `exit_plan_mode` flow). */
	canApprove: boolean;
	/** Build the page data (recomputed per request from the current plan). */
	page: () => Promise<ReviewPageData>;
	/** Persist the annotations and report the outcome. */
	save: (annotations: PlanAnnotation[]) => Promise<SaveResult>;
	/** Called after a successful save; the server resolves the session once the response has flushed. */
	onSaved: (annotations: PlanAnnotation[]) => void;
	/** Called after a successful approve; the server resolves the session once the response has flushed. */
	onApprove: (annotations: PlanAnnotation[]) => void;
	/** Called when the user cancels; the server resolves the session once the response has flushed. */
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
	if (!isLocalHostHeader(headers, { required: true })) {
		return jsonError(403, "Unexpected Host header.");
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
	const envelope = checkEnvelope(method, headers);
	if (envelope) return envelope;

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return jsonError(400, "Malformed request URL.");
	const { pathname, search } = parsed;

	if (pathname === "/favicon.ico") return { status: 204, headers: { "Cache-Control": "no-store" } };
	if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
	if (pathname === "/client.js") return { status: 200, headers: scriptHeaders(), body: REVIEW_CLIENT_JS };

	if (search.get("token") !== ctx.token) return jsonError(403, "Invalid or missing token.");

	if (pathname === "/" || pathname === "/index.html") {
		return { status: 200, headers: pageHeaders(), body: renderReviewPage(await ctx.page()) };
	}
	if (pathname === "/events") return { status: 200, headers: eventHeaders(), stream: true };
	if (pathname === "/api/cancel") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to cancel.");
		ctx.onCancel();
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/feedback") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to save feedback.");
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations);
		if (!result.ok) return jsonError(result.status, result.message);
		ctx.onSaved(annotations);
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/approve") {
		if (method.toUpperCase() !== "POST") return jsonError(405, "Use POST to approve.");
		// Only the exit_plan_mode flow owns the approval side effects, so a comment-only
		// review refuses this even if a client posts it directly.
		if (!ctx.canApprove) return jsonError(403, "This review cannot be approved from the browser.");
		const annotations = parseAnnotations(body);
		if (isResponse(annotations)) return annotations;
		const result = await ctx.save(annotations);
		if (!result.ok) return jsonError(result.status, result.message);
		ctx.onApprove(annotations);
		return jsonResponse(200, { ok: true });
	}

	return jsonError(404, "That page does not exist.");
}
