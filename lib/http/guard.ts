/**
 * The request guards both loopback servers apply before a route runs: the method
 * allowlist, the `Host` allowlist, the cross-origin refusal, and — for a server
 * that takes JSON — the content-type check.
 *
 * These were the `plan` review server's own three helpers until a second
 * mutating page needed them. A guard is a policy, and two copies of a policy are
 * how a `Host` rule or an origin rule drifts apart, so the sentences the client
 * reads and the order they are checked in live here once.
 *
 * Each guard answers `undefined` when the request may proceed and the response to
 * send instead when it may not, so a router reads as a chain of refusals.
 */

import { jsonHeaders } from "./headers.ts";
import { hostHeaderName, isAllowedHostHeader } from "./router.ts";
import { jsonError, type ServeResponse } from "./response.ts";

/** The methods a loopback server answers unless it says otherwise. */
export const PAGE_METHODS: readonly string[] = ["GET", "HEAD", "POST"];

/** The 405 for a route that only accepts POST, or nothing when the method is right. */
export function postOnly(method: string, what: string): ServeResponse | undefined {
	if (method.toUpperCase() === "POST") return undefined;
	return jsonError(405, `Use POST to ${what}.`);
}

/**
 * The 403 for a state-changing request another site made, or nothing when the
 * caller may proceed.
 *
 * A browser sends `Origin` on every state-changing request and `Sec-Fetch-Site`
 * with its own classification; a request with neither is a script or a test,
 * which has no ambient credential to abuse. A present `Origin` must name the host
 * the request was addressed to, so a page served by another site cannot drive
 * this one through a victim's browser.
 */
export function checkOrigin(headers: Record<string, string | string[] | undefined>): ServeResponse | undefined {
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
 * The 415 for a state-changing body that is not JSON, or nothing when it is.
 *
 * A server that only reads JSON refuses anything else early: an HTML form post
 * and a `text/plain` body cannot reach the parser, so the request cannot be
 * mounted cross-origin by a form or a `<script>` tag.
 */
export function requireJsonBody(contentType: string | string[] | undefined): ServeResponse | undefined {
	const value = Array.isArray(contentType) ? contentType[0] : contentType;
	if (typeof value === "string" && /^application\/json\s*(;|$)/i.test(value.trim())) return undefined;
	return jsonError(415, "The request body must be JSON.");
}

/** What a server answers, and to which host names. */
export interface EnvelopeOptions {
	/** The raw request method. */
	method: string;
	/** The raw request headers. */
	headers: Record<string, string | string[] | undefined>;
	/** The host names this server answers to now. */
	hosts: readonly string[];
	/** The methods it serves; `PAGE_METHODS` unless a route set needs more. */
	allowed?: readonly string[];
}

/**
 * The 405 or 403 a request deserves before any route runs, or nothing when the
 * envelope is acceptable.
 *
 * `Host` fails closed: a missing or non-string header is refused too, not just a
 * foreign one, so the DNS-rebinding guard cannot be skipped by omitting it. Every
 * method that is not a read is also checked for a foreign origin.
 */
export function envelopeRefusal(options: EnvelopeOptions): ServeResponse | undefined {
	const allowed = options.allowed ?? PAGE_METHODS;
	const upper = options.method.toUpperCase();
	if (!allowed.includes(upper)) {
		return {
			...jsonError(405, `Only ${joinMethods(allowed)} are served.`),
			headers: { ...jsonHeaders(), Allow: allowed.join(", ") },
		};
	}
	if (!isAllowedHostHeader(options.headers, { hosts: options.hosts, required: true })) {
		return jsonError(403, "Unexpected Host header.");
	}
	const reads = upper === "GET" || upper === "HEAD";
	return reads ? undefined : checkOrigin(options.headers);
}

/** `GET, HEAD, and POST` — the list as a sentence a person reads. */
function joinMethods(methods: readonly string[]): string {
	if (methods.length <= 1) return methods.join("");
	return `${methods.slice(0, -1).join(", ")}, and ${methods.at(-1)}`;
}
