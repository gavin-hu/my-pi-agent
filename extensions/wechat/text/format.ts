/**
 * Pure text helpers for the bridge: sanitize inbound text, chunk long replies,
 * and shorten peer ids for display. The peer-facing notices live in `notices.ts`.
 */

import { stripControlChars } from "../../../lib/format.ts";
import { sanitizeFileName } from "../transport/media.ts";
import type { CDNMedia, MediaRef, MessageItem } from "../types.ts";

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
 * Flatten assistant Markdown for a chat window.
 *
 * WeChat renders plain text, so fences, inline backticks, heading markers and
 * bold/italic emphasis all reach the peer as noise. Structural markers are
 * dropped and the text inside them is kept verbatim — a code block loses its
 * fence line, never its body. Control characters are stripped first.
 */
export function toWechatText(text: string): string {
	const lines = stripControlChars(text.replace(/\r\n?/g, "\n")).split("\n");
	const kept: string[] = [];
	let fenced = false;
	let blank = false;
	for (const line of lines) {
		// A fence line is dropped. The body between fences is kept verbatim: a
		// shell comment, a backtick, or a line that looks like Markdown is code, not
		// formatting, and rewriting it changes what the reader copies.
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			kept.push(line);
			continue;
		}
		const flat = line
			.replace(/^\s{0,3}#{1,6}\s+/, "")
			.replace(/\*\*|__|~~/g, "")
			.replace(/`/g, "")
			.replace(/[ \t]+$/, "");
		// Collapse a run of blank lines outside code, as the whole-text replace did.
		if (flat === "") {
			if (blank) continue;
			blank = true;
			kept.push("");
			continue;
		}
		blank = false;
		kept.push(flat);
	}
	return kept.join("\n").trim();
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

/** The language a peer is answered in. */
export type PeerLanguage = "zh" | "en";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** The language to answer `text` in: Chinese when it contains CJK characters. */
export function peerLanguage(text: string): PeerLanguage {
	return CJK.test(text) ? "zh" : "en";
}

/** Drop the `@im.wechat` suffix from a peer id for a compact label. */
export function peerLabel(peer: string): string {
	return peer.replace(/@im\.wechat$/i, "");
}

/**
 * The comparable identity of a peer id: trimmed, with the `@im.wechat` suffix
 * dropped. `allowedPeers` accepts either form, so an operator who copies the
 * label the control screen shows is not silently refused.
 */
export function peerKey(id: string): string {
	return peerLabel(id.trim()).toLowerCase();
}

/** Whether a media reference has something to download. */
function hasMedia(ref: CDNMedia | undefined): ref is CDNMedia {
	return !!ref && (!!ref.encrypt_query_param || !!ref.full_url);
}

/**
 * Split an inbound `item_list` into text, downloadable media, and items the
 * bridge cannot read at all.
 *
 * Text items and voice transcripts are combined and sanitized (both are
 * untrusted). Images and files with a usable CDN reference become {@link MediaRef}
 * entries. `unsupported` counts what a peer plausibly meant to send but the
 * bridge has no way to read — a voice note the server gave no transcript for, a
 * video — so the caller can say so instead of dropping it silently.
 */
export function parseInbound(itemList: MessageItem[] | undefined): {
	text: string;
	media: MediaRef[];
	unsupported: number;
} {
	const parts: string[] = [];
	const media: MediaRef[] = [];
	let unsupported = 0;
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
		} else if (item.video_item) {
			unsupported += 1;
		} else if (item.type === 3 || item.type === 2 || item.type === 4) {
			// A voice note without a transcript, or an attachment with no usable CDN
			// reference: nothing to read, but the peer did send something.
			unsupported += 1;
		}
	}
	return { text: sanitizeInbound(parts.join("\n")), media, unsupported };
}
