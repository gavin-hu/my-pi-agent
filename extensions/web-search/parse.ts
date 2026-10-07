/**
 * DuckDuckGo HTML parsing.
 *
 * The classic endpoint returns one `<div class="result …">` per hit, each with a
 * `result__a` title anchor and an optional `result__snippet`. This module turns
 * that markup into `SearchResult[]` with no dependencies: it decodes HTML
 * entities, unwraps the `/l/?uddg=` redirect, strips markup, and drops ads and
 * duplicates. It is pure and UTF-8 safe (CJK text passes through untouched).
 */

import type { SearchResult } from "./types.ts";

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	mdash: "—",
	ndash: "–",
};

/** Decode named and numeric HTML entities. Unknown entities are left as-is. */
export function decodeEntities(input: string): string {
	return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body.startsWith("#")) {
			const hex = body[1] === "x" || body[1] === "X";
			const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}

/** Strip tags, decode entities, and collapse whitespace into one line. */
export function toPlainText(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function attr(openingTag: string, name: string): string | undefined {
	const match = openingTag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
	return match ? decodeEntities(match[1]) : undefined;
}

/**
 * Resolve a result href to an absolute URL, unwrapping DuckDuckGo's
 * `//duckduckgo.com/l/?uddg=<encoded target>` redirect when present.
 */
export function resolveResultUrl(raw: string): string | undefined {
	const href = decodeEntities(raw.trim());
	if (!href) return undefined;

	let url: URL;
	try {
		url = new URL(href, "https://duckduckgo.com");
	} catch {
		return undefined;
	}

	if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname.startsWith("/l/")) {
		const target = url.searchParams.get("uddg");
		if (target) {
			try {
				url = new URL(decodeEntities(target));
			} catch {
				return undefined;
			}
		} else {
			return undefined;
		}
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	return url.toString();
}

interface Block {
	index: number;
	className: string;
}

function findResultBlocks(html: string): Block[] {
	const blocks: Block[] = [];
	const re = /<div[^>]*class="([^"]*)"[^>]*>/gi;
	for (const match of html.matchAll(re)) {
		const className = match[1];
		if (/(?:^|\s)result(?:\s|$)/.test(className)) {
			blocks.push({ index: match.index ?? 0, className });
		}
	}
	return blocks;
}

/**
 * Parse the classic DuckDuckGo HTML page into at most `limit` organic results.
 *
 * Advert blocks (`result--ad`) are skipped, as are entries without a title
 * anchor or an http(s) URL. Duplicate URLs are removed, keeping the first.
 */
export function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
	const blocks = findResultBlocks(html);
	const results: SearchResult[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < blocks.length && results.length < limit; i++) {
		const block = blocks[i];
		if (block.className.includes("result--ad")) continue;

		const segment = html.slice(block.index, i + 1 < blocks.length ? blocks[i + 1].index : html.length);

		const anchor = segment.match(/<a\b([^>]*\bclass="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/i);
		if (!anchor) continue;

		const rawHref = attr(anchor[1], "href");
		const url = rawHref ? resolveResultUrl(rawHref) : undefined;
		if (!url || seen.has(url)) continue;

		const title = toPlainText(anchor[2]);
		if (!title) continue;

		const snippetMatch = segment.match(
			/<(?:a|div|span)\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
		);
		const snippet = snippetMatch ? toPlainText(snippetMatch[1]) : "";

		seen.add(url);
		results.push({ title, url, snippet });
	}

	return results;
}

/** True when DuckDuckGo served its anti-bot challenge instead of results. */
export function isChallengePage(html: string): boolean {
	return /challenge-form|anomaly-modal|anomaly__title|Unfortunately, bots use DuckDuckGo/i.test(html);
}
