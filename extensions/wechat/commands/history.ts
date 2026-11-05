/**
 * Read-only history for the chat.
 *
 * The conversation is this Pi session's, so `/history` reads the session's own
 * entries: nothing is opened, resumed, or written, and asking for history cannot
 * change the conversation it describes.
 */

import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { codePointSlice, type PeerLanguage } from "../text/format.ts";

/** Longest text one history line carries before it is elided. */
export const HISTORY_LINE_CHARS = 160;

/**
 * The name a line gives each side, in the peer's language: the peer's own messages
 * are "you" to them, and the assistant is "me".
 */
const LABELS: Record<PeerLanguage, { user: string; assistant: string }> = {
	en: { user: "You", assistant: "Me" },
	zh: { user: "你", assistant: "我" },
};

/** The text of one user/assistant entry, flattened to one line. */
function textOf(entry: SessionMessageEntry): string {
	const { message } = entry;
	if (message.role !== "user" && message.role !== "assistant") return "";
	const content = message.content;
	const text =
		typeof content === "string"
			? content
			: content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
	return text.replace(/\s+/g, " ").trim();
}

/** One line per message, oldest first, at most `count` messages. */
export function formatHistory(entries: SessionEntry[], count: number, lang: PeerLanguage = "en"): string {
	const keep = Math.max(0, Math.trunc(count));
	if (keep === 0) return "";
	const labels = LABELS[lang];
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const text = textOf(entry);
		if (!text) continue;
		const who = entry.message.role === "user" ? labels.user : labels.assistant;
		// Counted in code points, so a cut cannot split a surrogate pair into a
		// replacement glyph.
		const { slice, total } = codePointSlice(text, HISTORY_LINE_CHARS - 1);
		const shown = total > HISTORY_LINE_CHARS ? `${slice}…` : text;
		lines.push(`${who}: ${shown}`);
	}
	return lines.slice(-keep).join("\n");
}
