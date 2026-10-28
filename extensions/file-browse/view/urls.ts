/**
 * URL policy for rendered Markdown: the one place a link or image destination
 * becomes something the page may emit.
 *
 * A destination is either an in-page anchor, an allowlisted external scheme, or
 * a path relative to the file being rendered, which is rewritten to `/view/<path>`
 * or `/raw/<path>` so it resolves from any page URL. Everything else resolves to
 * `undefined` and the caller degrades to text. The `/view` and `/raw` routes
 * re-vet the path at fetch time, so this module only has to reject obvious
 * escapes, not guarantee containment.
 *
 * Shared by the Markdown link/image renderer and the raw-HTML sanitizer, so both
 * apply the same scheme allowlist and the same `/view`/`/raw` mapping.
 */

import { posix } from "node:path";
import { encodePath } from "../files/paths.ts";

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_LINK_SCHEME = /^(?:https?|mailto):/i;
const HTTP_SCHEME = /^https?:/i;

/** A link destination the page may emit. */
export interface ResolvedLink {
	href: string;
	external: boolean;
}

/**
 * Where a destination resolves from, and what it is written under.
 *
 * `dir` is the root-relative directory the destination is relative to; `base` is the
 * prefix the page answers under, so a page served at `/files` writes
 * `/files/view/<path>` and one holding the origin's root writes `/view/<path>`. The two
 * are one value because a caller that knows one almost always knows the other, and a
 * second parameter is a second thing to thread through ten functions.
 */
export interface LinkBase {
	dir: string;
	base: string;
}

/** An image destination the page may emit; `image: false` means link to it instead. */
export interface ResolvedImage {
	href: string;
	image: boolean;
}

/** Resolve a relative path under `baseDir` to a root-relative path and query/fragment suffix. */
function resolveLocalPath(href: string, baseDir: string): { rel: string; suffix: string } | undefined {
	const match = /^([^?#]*)([?#].*)?$/.exec(href);
	if (!match) return undefined;
	const rawPath = match[1];
	const suffix = match[2] ?? "";
	let path: string;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		path = rawPath;
	}
	let rel: string;
	if (path.startsWith("/")) rel = posix.normalize(path).replace(/^\/+/, "");
	else rel = posix.normalize(posix.join(baseDir, path));
	if (rel === ".") rel = "";
	if (rel === ".." || rel.startsWith("../") || rel.startsWith("/")) return undefined;
	return { rel, suffix };
}

/** Resolve a link destination, or `undefined` when the scheme or path is not allowed. */
export function resolveLink(dest: string, linkBase: LinkBase): ResolvedLink | undefined {
	const value = dest.trim();
	if (value === "") return undefined;
	if (value.startsWith("#")) return { href: value, external: false };
	if (SAFE_LINK_SCHEME.test(value)) return { href: value, external: HTTP_SCHEME.test(value) };
	if (HAS_SCHEME.test(value)) return undefined;
	const local = resolveLocalPath(value, linkBase.dir);
	if (!local) return undefined;
	return { href: `${linkBase.base}/view/${encodePath(local.rel)}${local.suffix}`, external: false };
}

/**
 * Resolve an image destination. A local path maps to `/raw`; an external http(s)
 * URL resolves with `image: false` because the page CSP forbids remote images, so
 * the caller renders a link instead of an `<img>`.
 */
export function resolveImage(dest: string, linkBase: LinkBase): ResolvedImage | undefined {
	const value = dest.trim();
	if (value === "") return undefined;
	if (HTTP_SCHEME.test(value)) return { href: value, image: false };
	if (HAS_SCHEME.test(value)) return undefined;
	const local = resolveLocalPath(value, linkBase.dir);
	if (!local) return undefined;
	return { href: `${linkBase.base}/raw/${encodePath(local.rel)}${local.suffix}`, image: true };
}
