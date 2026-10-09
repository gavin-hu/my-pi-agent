/**
 * Pure text helpers for the bridge: sanitize inbound text, chunk long replies,
 * and shorten peer ids for display.
 */

import { stripControlChars } from "../../lib/format.ts";

/**
 * Prepare inbound WeChat text before it becomes a user turn: strip terminal
 * control characters, normalize line endings, and trim. The text is untrusted.
 */
export function sanitizeInbound(text: string): string {
	return stripControlChars(text.replace(/\r\n?/g, "\n"))
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

/**
 * Split `text` into chunks of at most `max` characters, preferring a line break
 * and never returning an empty chunk. A non-positive `max` returns the text whole.
 */
export function chunkText(text: string, max: number): string[] {
	if (!Number.isFinite(max) || max <= 0 || text.length <= max) return [text];
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > max) {
		let cut = rest.lastIndexOf("\n", max);
		if (cut <= 0) cut = max;
		const chunk = rest.slice(0, cut).trim();
		if (chunk) chunks.push(chunk);
		rest = rest.slice(cut).trim();
	}
	if (rest) chunks.push(rest);
	return chunks.length > 0 ? chunks : [text];
}

/** Drop the `@im.wechat` suffix from a peer id for a compact label. */
export function peerLabel(peer: string): string {
	return peer.replace(/@im\.wechat$/i, "");
}
