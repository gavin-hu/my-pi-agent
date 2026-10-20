/**
 * The response header sets both loopback servers answer with.
 *
 * One policy, declared once: the pages `file-browse` and `plan` serve are the
 * same kind of document — a same-origin script, inline styles, and no network
 * — so they must not drift into different envelopes, and a page that refuses to
 * be framed cannot quietly stop doing so on one surface only.
 *
 * Every builder returns a fresh object, so a caller may add to a response
 * without writing into another one. The policy itself is a code-authored
 * constant; nothing here is model- or file-derived.
 */

/**
 * The page policy. `default-src 'none'` makes every fetch opt-in; the inline
 * style allowance is the page's own `<style>` block, `script-src 'self'` the
 * same-origin client, and `connect-src 'self'` the page's own API routes.
 *
 * The last three directives are the ones that make a local page safe to leave
 * open: `frame-ancestors 'none'` (with the legacy `X-Frame-Options`) stops a
 * local page from framing the surface and clickjacking a control with a side
 * effect, `base-uri 'self'` stops an injected `<base>` from re-pointing every
 * relative URL, and `form-action 'none'` stops a submission anywhere.
 */
export const PAGE_CSP =
	"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; " +
	"connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

/** The security and caching headers every response carries, whatever its body. */
function secured(contentType: string): Record<string, string> {
	return {
		"Content-Type": contentType,
		"Content-Security-Policy": PAGE_CSP,
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Cache-Control": "no-store",
	};
}

/** Headers for a served HTML page. */
export function pageHeaders(): Record<string, string> {
	return secured("text/html; charset=utf-8");
}

/** Headers for a same-origin script: the page policy, with the script's own type. */
export function scriptHeaders(): Record<string, string> {
	return secured("text/javascript; charset=utf-8");
}

/** Headers for a JSON API reply: the same envelope, a JSON type. */
export function jsonHeaders(): Record<string, string> {
	return secured("application/json; charset=utf-8");
}
