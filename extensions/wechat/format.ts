/**
 * Pure text helpers for the bridge: sanitize inbound text, chunk long replies,
 * shorten peer ids for display, and render the short peer-facing notices.
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

/** The language a peer is answered in. */
export type PeerLanguage = "zh" | "en";

/**
 * The notices the bridge sends on its own, outside a reply. Every one is a
 * single short line in the peer's language: WeChat pings per message, so a
 * notice has to earn its bubble.
 */
export type NoticeKind =
	| "ack"
	| "overflow"
	| "media"
	| "unsupported"
	| "stopped"
	| "promptWaiting"
	| "timeout"
	| "failed"
	| "newBusy";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** The language to answer `text` in: Chinese when it contains CJK characters. */
export function peerLanguage(text: string): PeerLanguage {
	return CJK.test(text) ? "zh" : "en";
}

const NOTICES: Record<NoticeKind, Record<PeerLanguage, string>> = {
	ack: { zh: "收到，正在处理…", en: "Got it — working on it." },
	overflow: { zh: "消息有点多，稍后再发。", en: "Too many messages queued — please wait a moment." },
	media: {
		zh: "有 {n} 个附件没能读取，可以重发或直接说明。",
		en: "Couldn't open {n} attachment(s) — please resend or describe it.",
	},
	unsupported: {
		zh: "语音（无转写）和视频暂不支持，请发文字或图片。",
		en: "Voice without a transcript and video aren't supported — please send text or an image.",
	},
	stopped: { zh: "已停止。", en: "Stopped." },
	promptWaiting: {
		zh: "还在等你的回复，约 1 分钟后超时。",
		en: "Still waiting for your reply — this expires in about a minute.",
	},
	timeout: { zh: "问题超时，已取消。", en: "That question timed out." },
	failed: { zh: "处理失败，请稍后重试。", en: "Something went wrong — please try again." },
	newBusy: {
		zh: "正在处理当前消息，稍后再发送 /new。",
		en: "Still working on your last message — send /new again after it finishes.",
	},
};

/** Render one notice, with `{n}` replaced when a count applies. */
export function notice(kind: NoticeKind, lang: PeerLanguage, count?: number): string {
	const text = NOTICES[kind][lang];
	return count === undefined ? text : text.replace("{n}", String(count));
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
