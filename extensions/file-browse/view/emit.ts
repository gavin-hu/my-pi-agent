/**
 * The elements a page emits for a resolved Markdown link or image.
 *
 * Two renderers reach a link: the Markdown renderer (`markdown.ts`) and the raw-HTML
 * sanitizer (`raw-html.ts`). Both ask `urls.ts` what a destination resolves to, and both
 * then build the same anchor and the same image — the external-rel attributes, the
 * `md-img` class, and the lazy decoding — so those live here rather than in a fourth and
 * fifth copy. Values are escaped here; the callers hand in what the document said.
 */

import { escapeHtml } from "../../../lib/escape.ts";

/**
 * The attributes an external link carries, for a caller that is building the element
 * itself: the raw-HTML sanitizer rewrites an existing tag's attribute list and has no
 * content string to hand an emitter.
 *
 * `noopener` because the target is another origin, and `noreferrer` because the page is a
 * local view of the reader's own repository and should not tell anyone where they read it.
 */
export const EXTERNAL_ATTRS = ' target="_blank" rel="noopener noreferrer"';

/** An `<a>` for one destination; `title` and the rel attributes are omitted when absent. */
export function emitAnchor(input: { href: string; content: string; title?: string; external: boolean }): string {
	const title = input.title === undefined ? "" : ` title="${escapeHtml(input.title)}"`;
	return `<a href="${escapeHtml(input.href)}"${title}${input.external ? EXTERNAL_ATTRS : ""}>${input.content}</a>`;
}

/**
 * A link standing in for an image the page may not show: an external `src` is blocked by
 * the CSP, so the reader gets something to click, labelled by the alt text.
 */
export function emitImageLink(href: string, label: string): string {
	return `<a href="${escapeHtml(href)}"${EXTERNAL_ATTRS}>${escapeHtml(label)}</a>`;
}

/** An `<img>`: block-level spacing class, alt text, and the sizes a document may pin. */
export function emitImage(input: {
	href: string;
	alt: string;
	title?: string;
	/** A document may pin a pixel size; escaped like every other value the page emits. */
	width?: string | number;
	height?: string | number;
}): string {
	const size = `${input.width === undefined ? "" : ` width="${escapeHtml(String(input.width))}"`}${
		input.height === undefined ? "" : ` height="${escapeHtml(String(input.height))}"`
	}`;
	const title = input.title === undefined ? "" : ` title="${escapeHtml(input.title)}"`;
	return `<img class="md-img" src="${escapeHtml(input.href)}" alt="${escapeHtml(input.alt)}"${size}${title} loading="lazy" decoding="async">`;
}
