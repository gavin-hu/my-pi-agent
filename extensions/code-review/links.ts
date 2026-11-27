/**
 * The review's own addresses, and the prefix they answer under.
 *
 * One page, one prefix: the review links only into itself, so this is the whole vocabulary a
 * bookmark, a redirect or the file view needs. A comparison rides the query as the preset's
 * word when one names it, else as its two sides, so a link round-trips through the same
 * parser the tool uses. `URLSearchParams` does the encoding once, because a path can hold a
 * `+` or a `#` that hand-built text would put into the query as themselves and the router
 * would read back as something else.
 *
 * No imports beyond the scope's own words: the leaf the routes and the views both read.
 */

import { type ReviewPreset, type ReviewScope, wireSide } from "./scope.ts";

/** The prefix the page claims from the session's server. */
export const REVIEW_BASE = "/review";

/** The query a comparison rides: its word when one names it, else the two sides it compares. */
export function scopeQuery(scope: ReviewScope, preset?: ReviewPreset): Record<string, string> {
	if (preset !== undefined) return { scope: preset };
	return { from: wireSide(scope.from), to: wireSide(scope.to) };
}

/** The page for a comparison named by a preset word, which needs no sides spelled out. */
export function presetHref(preset: ReviewPreset, file?: string): string {
	const query = new URLSearchParams({ scope: preset });
	if (file !== undefined) query.set("file", file);
	return `${REVIEW_BASE}/new?${query.toString()}`;
}

/** The review page for a comparison and, when a link names one, one file. */
export function newHref(scope: ReviewScope, preset?: ReviewPreset, file?: string): string {
	const query = new URLSearchParams(scopeQuery(scope, preset));
	if (file !== undefined) query.set("file", file);
	return `${REVIEW_BASE}/new?${query.toString()}`;
}

/**
 * One listed file's whole text, as the view that draws it.
 *
 * The token is the page's, and the view carries it so the page can hold its own stream: a file
 * view is the same review in the same tab, and a document that attaches nothing would look to
 * the mount like a tab that left. A link with no token still reads the file; it just holds no
 * page, which is what a pasted or stale address deserves.
 */
export function fileHref(rel: string, scope: ReviewScope, preset?: ReviewPreset, token?: string): string {
	const query = new URLSearchParams({ ...scopeQuery(scope, preset), path: rel });
	if (token !== undefined) query.set("token", token);
	return `${REVIEW_BASE}/file?${query.toString()}`;
}
