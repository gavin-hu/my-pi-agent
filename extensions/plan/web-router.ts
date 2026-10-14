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

import { REVIEW_CLIENT_JS } from "./web-client.ts";
import { THEME_JS } from "../../lib/web/index.ts";
import { coerceAnnotations, type PlanAnnotation } from "./feedback.ts";
import { renderReviewPage, type ReviewPageData } from "./web-page.ts";

/** What a save callback reports back. */
export type SaveResult = { ok: true } | { ok: false; status: number; message: string };

/** Everything the router needs from the running session. */
export interface ReviewContext {
	/** Per-session secret required on the page, event stream, and API routes. */
	token: string;
	/** Build the page data (recomputed per request from the current plan). */
	page: () => Promise<ReviewPageData>;
	/** Persist the annotations and report the outcome. */
	save: (annotations: PlanAnnotation[]) => Promise<SaveResult>;
	/** Called after a successful save, to resolve the session. */
	onSaved: (annotations: PlanAnnotation[]) => void;
	/** Called when the user cancels, to resolve the session. */
	onCancel: () => void;
}

export interface ServeResponse {
	status: number;
	headers: Record<string, string>;
	body?: string;
	/** When true, the node server keeps the connection open as an SSE stream. */
	stream?: boolean;
}

const HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

const HTML_SECURITY: Record<string, string> = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy":
		"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};

const SCRIPT_HEADERS: Record<string, string> = {
	...HTML_SECURITY,
	"Content-Type": "text/javascript; charset=utf-8",
};

const JSON_HEADERS: Record<string, string> = {
	"Content-Type": "application/json; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};

const EVENT_HEADERS: Record<string, string> = {
	"Content-Type": "text/event-stream; charset=utf-8",
	"Cache-Control": "no-store",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
};

function jsonResponse(status: number, value: unknown): ServeResponse {
	return { status, headers: { ...JSON_HEADERS }, body: JSON.stringify(value) };
}

function errorResponse(status: number, message: string): ServeResponse {
	return jsonResponse(status, { error: message });
}

/** Validate method and `Host`; returns an error response to send instead. */
function checkEnvelope(
	method: string,
	headers: Record<string, string | string[] | undefined>,
): ServeResponse | undefined {
	const upper = method.toUpperCase();
	if (upper !== "GET" && upper !== "HEAD" && upper !== "POST") {
		return { ...errorResponse(405, "Only GET and POST are served."), headers: { ...JSON_HEADERS, Allow: "GET, POST" } };
	}
	const host = headers.host;
	if (typeof host === "string" && host && !HOST_PATTERN.test(host)) {
		return errorResponse(403, "Unexpected Host header.");
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

	let pathname: string;
	let search: URLSearchParams;
	try {
		const url = new URL(rawUrl, "http://127.0.0.1");
		pathname = url.pathname;
		search = url.searchParams;
	} catch {
		return errorResponse(400, "Malformed request URL.");
	}

	if (pathname === "/favicon.ico") return { status: 204, headers: { ...SCRIPT_HEADERS } };
	if (pathname === "/theme.js") return { status: 200, headers: { ...SCRIPT_HEADERS }, body: THEME_JS };
	if (pathname === "/client.js") return { status: 200, headers: { ...SCRIPT_HEADERS }, body: REVIEW_CLIENT_JS };

	if (search.get("token") !== ctx.token) return errorResponse(403, "Invalid or missing token.");

	if (pathname === "/" || pathname === "/index.html") {
		return { status: 200, headers: { ...HTML_SECURITY }, body: renderReviewPage(await ctx.page()) };
	}
	if (pathname === "/events") return { status: 200, headers: { ...EVENT_HEADERS }, stream: true };
	if (pathname === "/api/cancel") {
		if (method.toUpperCase() !== "POST") return errorResponse(405, "Use POST to cancel.");
		ctx.onCancel();
		return jsonResponse(200, { ok: true });
	}
	if (pathname === "/api/feedback") {
		if (method.toUpperCase() !== "POST") return errorResponse(405, "Use POST to save feedback.");
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			return errorResponse(400, "The request body must be JSON.");
		}
		const annotations = coerceAnnotations((parsed as { annotations?: unknown } | null)?.annotations);
		if (!annotations) return errorResponse(400, "The annotations are malformed.");
		const result = await ctx.save(annotations);
		if (!result.ok) return errorResponse(result.status, result.message);
		ctx.onSaved(annotations);
		return jsonResponse(200, { ok: true });
	}

	return errorResponse(404, "That page does not exist.");
}
