/**
 * The request-envelope helpers both servers apply before a route runs: the
 * request target, and the `Host` allowlist.
 *
 * A server answers to the names it was bound on and nothing else, so a `Host`
 * naming anything else is a DNS-rebinding attempt against a page the owner
 * opened. How strictly a missing `Host` is treated is the caller's decision: the
 * browse server accepts one, because its router is also driven directly from
 * tests and a plain `GET` with no header is not a rebinding, while the review
 * server fails closed.
 */

/** The names a loopback-bound server answers to. */
export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/** The host name in a `Host` header, without its port, lowercased. */
export function hostHeaderName(host: string): string {
	const text = host.trim().toLowerCase();
	if (text.startsWith("[")) {
		const end = text.indexOf("]");
		return end > 0 ? text.slice(0, end + 1) : text;
	}
	const first = text.indexOf(":");
	// No colon, or an unbracketed IPv6 address whose colons are not a port.
	if (first <= 0 || first !== text.lastIndexOf(":")) return text;
	return /^\d+$/.test(text.slice(first + 1)) ? text.slice(0, first) : text;
}

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
 * Whether the request's `Host` names one of the hosts this server answers to.
 *
 * With `required: false`, only a present, non-empty foreign name is refused, so
 * a header-less request from another caller still routes. With `required: true`,
 * a missing or non-string `Host` is refused too, so the guard cannot be skipped
 * by omitting the header.
 */
export function isAllowedHostHeader(
	headers: Record<string, string | string[] | undefined>,
	options: { hosts: readonly string[]; required: boolean },
): boolean {
	const host = headers.host;
	if (typeof host !== "string" || host === "") return !options.required;
	const name = hostHeaderName(host);
	return options.hosts.some((allowed) => hostHeaderName(allowed) === name);
}

/**
 * Whether the request's `Host` names this loopback server. A caller that binds
 * anything other than loopback passes its own names to
 * {@link isAllowedHostHeader} instead.
 */
export function isLocalHostHeader(
	headers: Record<string, string | string[] | undefined>,
	options: { required: boolean },
): boolean {
	return isAllowedHostHeader(headers, { hosts: LOOPBACK_HOSTS, required: options.required });
}
