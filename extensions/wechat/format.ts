/**
 * Pure text helpers for the bridge: sanitize inbound text, chunk long replies,
 * and shorten peer ids for display.
 */

import { stripControlChars } from "../../lib/format.ts";
import { sanitizeFileName } from "./media.ts";
import type { CDNMedia, MediaRef, MessageItem } from "./types.ts";

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

/** Whether a media reference has something to download. */
function hasMedia(ref: CDNMedia | undefined): ref is CDNMedia {
	return !!ref && (!!ref.encrypt_query_param || !!ref.full_url);
}

/**
 * Split an inbound `item_list` into text and downloadable media.
 *
 * Text items and voice transcripts are combined and sanitized (both are
 * untrusted). Images and files with a usable CDN reference become {@link MediaRef}
 * entries; video and unknown items are ignored. A media-only message yields an
 * empty `text`.
 */
export function parseInbound(itemList: MessageItem[] | undefined): { text: string; media: MediaRef[] } {
	const parts: string[] = [];
	const media: MediaRef[] = [];
	for (const item of itemList ?? []) {
		if (item.type === 1 && typeof item.text_item?.text === "string") {
			parts.push(item.text_item.text);
		} else if (item.type === 3 && typeof item.voice_item?.text === "string") {
			parts.push(item.voice_item.text);
		} else if (item.type === 2 && hasMedia(item.image_item?.media)) {
			media.push({ kind: "image", media: item.image_item.media, aeskey: item.image_item.aeskey });
		} else if (item.type === 4 && hasMedia(item.file_item?.media)) {
			media.push({
				kind: "file",
				media: item.file_item.media,
				fileName: sanitizeFileName(item.file_item.file_name ?? "file"),
			});
		}
	}
	return { text: sanitizeInbound(parts.join("\n")), media };
}
