/**
 * Read-only history for one peer's own conversation.
 *
 * `/history` must not create or resume a session: it opens the newest session
 * file in the peer's directory, reads its entries, and formats the last few
 * user/assistant messages. Nothing is written, so asking for history cannot
 * change the conversation it describes.
 */

import { SessionManager, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { peerSessionDir } from "../peer/peer-session.ts";

/** Longest text one history line carries before it is elided. */
export const HISTORY_LINE_CHARS = 160;

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
export function formatHistory(entries: SessionEntry[], count: number): string {
	const lines: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const text = textOf(entry);
		if (!text) continue;
		const who = entry.message.role === "user" ? "You" : "Me";
		const shown = text.length > HISTORY_LINE_CHARS ? `${text.slice(0, HISTORY_LINE_CHARS - 1)}…` : text;
		lines.push(`${who}: ${shown}`);
	}
	return lines.slice(-Math.max(0, count)).join("\n");
}

/**
 * The last `count` messages of the peer's newest conversation, or an empty
 * string when that peer has no session yet.
 */
export async function readPeerHistory(cwd: string, sessionsDir: string, peer: string, count: number): Promise<string> {
	let sessions;
	try {
		sessions = await SessionManager.list(cwd, peerSessionDir(sessionsDir, peer));
	} catch {
		return "";
	}
	const newest = sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
	if (!newest) return "";
	try {
		return formatHistory(SessionManager.open(newest.path).getEntries(), count);
	} catch {
		return "";
	}
}
