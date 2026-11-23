/**
 * The review's own addresses, and the prefix they answer under.
 *
 * One page, one prefix: the review links only into itself, so this is the whole vocabulary a
 * bookmark, a redirect or the file view needs. `URLSearchParams` does the encoding once,
 * because a path can hold a `+` or a `#` that hand-built text would put into the query as
 * themselves and the router would read back as something else.
 *
 * No imports: the leaf the routes and the views both read.
 */

/** The prefix the page claims from the session's server. */
export const REVIEW_BASE = "/review";

/** The review page for a comparison and, when a link names one, one file. */
export function newHref(scope: string, file?: string): string {
	const query = new URLSearchParams({ scope });
	if (file !== undefined) query.set("file", file);
	return `${REVIEW_BASE}/new?${query.toString()}`;
}

/** One listed file's whole text, as the view that draws it. */
export function fileHref(rel: string, scope: string): string {
	return `${REVIEW_BASE}/file?${new URLSearchParams({ scope, path: rel }).toString()}`;
}
