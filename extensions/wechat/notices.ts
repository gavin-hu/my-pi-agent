/**
 * The short peer-facing notices the bridge sends on its own.
 *
 * Every one is a single line in the peer's language: WeChat pings per message,
 * so a notice has to earn its bubble. Kept apart from `format.ts` so the text
 * helpers stay text helpers and the notice catalog can be reviewed in one place.
 */

import type { PeerLanguage } from "./format.ts";

/** One stock line the bridge can send outside a reply. */
export type NoticeKind =
	| "ack"
	| "busy"
	| "stillWorking"
	| "overflow"
	| "media"
	| "unsupported"
	| "stopped"
	| "noText"
	| "compacted"
	| "budget"
	| "promptWaiting"
	| "timeout"
	| "failed"
	| "newBusy";

const NOTICES: Record<NoticeKind, Record<PeerLanguage, string>> = {
	ack: { zh: "收到，正在处理…", en: "Got it — working on it." },
	busy: {
		zh: "前面还有一条正在处理，你的消息排在后面，轮到你就回你。",
		en: "Your message is queued behind another conversation; I'll answer as soon as it's free.",
	},
	stillWorking: {
		zh: "还在处理这条，稍等一下…",
		en: "Still working on this one — a moment…",
	},
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
	noText: {
		zh: "这条处理完了，但没有文字输出。",
		en: "That turn finished without any text to send.",
	},
	compacted: {
		zh: "对话较长，上下文已压缩；更早的细节可能记不全。",
		en: "The conversation was compacted to stay within context; earlier details may be fuzzy.",
	},
	budget: {
		zh: "这一小时的消息有点多，稍后再试。",
		en: "You've reached this hour's message limit — please try again later.",
	},
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
