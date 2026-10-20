/**
 * The request-envelope helpers both loopback routers apply before a route runs:
 * the request target, and the `Host` allowlist.
 *
 * Both surfaces bind `127.0.0.1`, so a `Host` naming anything else is a
 * DNS-rebinding attempt against a local page. How strictly a missing `Host` is
 * treated is the caller's decision: the browse server accepts one, because its
 * router is also driven directly from tests and a plain `GET` with no header is
 * not a rebinding, while the review server fails closed.
 */

/** The `Host` names a loopback interface, with or without a port. */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** A request target split into the parts a router matches on. */
export interface ParsedRequestUrl {
	/** The path, with the leading slash and no query. */
	pathname: string;
	/** The parsed query string. */
	search: URLSearchParams;
}

/**
 * Parse a raw request target (`path?query`) against a loopback base. Returns
 * `undefined` for a target that cannot be parsed, which a router answers with
 * `400` rather than a route.
 */
export function parseRequestUrl(rawUrl: string): ParsedRequestUrl | undefined {
	try {
		const url = new URL(rawUrl, "http://127.0.0.1");
		return { pathname: url.pathname, search: url.searchParams };
	} catch {
		return undefined;
	}
}

/**
 * Whether the request's `Host` names this loopback server.
 *
 * With `required: false`, only a present, non-empty foreign name is refused, so
 * a header-less request from another caller still routes. With `required: true`,
 * a missing or non-string `Host` is refused too, so the guard cannot be skipped
 * by omitting the header.
 */
export function isLocalHostHeader(
	headers: Record<string, string | string[] | undefined>,
	options: { required: boolean },
): boolean {
	const host = headers.host;
	if (typeof host !== "string" || host === "") return !options.required;
	return LOCAL_HOST.test(host);
}
