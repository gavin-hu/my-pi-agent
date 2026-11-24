/**
 * The sentence a review's send reaches the model with, at its next turn.
 *
 * The reviewer's `Send feedback` is one burst: the marker, a counted headline,
 * one `path:line — what they wrote` row each, and a hint that names the action
 * that reads the rest when the burst was capped. Nothing here wakes a turn — the
 * page's own dialog promises "at its next turn" — so the reporter this feeds is
 * the one with `wakeRequested: () => false`.
 */

import { clipText, pathRef, plural, sanitizeLine } from "../../lib/format.ts";
import { burstText, type NoticeItem, noticeMessage, type NoticeMessage } from "../../lib/notice.ts";

/** One send's comments, as the notice and the tool read them. */
export interface ReviewSend {
	/** The review the comments belong to. */
	id: string;
	comments: ReadonlyArray<{ rel: string; line: number; endLine?: number; body: string }>;
	/** When the send was written. */
	at: number;
}

/** Most rows a notice carries before it counts the rest. */
export const NOTICE_ROWS = 5;
/** Longest row's text, in characters. */
export const NOTICE_ROW_CHARS = 120;

/** The marker the model reads first. */
export const REVIEW_MARKER = "[CODE REVIEW]";

/** The notice one burst of sends becomes. */
export function reviewNotice(sends: readonly ReviewSend[]): NoticeMessage {
	const comments = sends.flatMap((send) => send.comments);
	const rows = comments.slice(0, NOTICE_ROWS);
	const rest = comments.length - rows.length;
	const content = burstText({
		marker: REVIEW_MARKER,
		headline: `${plural(comments.length, "review comment")} sent`,
		lines: rows.map(
			(comment) =>
				`${sanitizeLine(pathRef(comment.rel, comment.line, comment.endLine))} — ${clipText(sanitizeLine(comment.body), NOTICE_ROW_CHARS)}`,
		),
		...(rest > 0 ? { more: `… ${rest} more` } : {}),
		hint: 'Run `code_review` action "comments" for all of them.',
	});
	const items: NoticeItem[] = rows.map((comment) => ({
		label: sanitizeLine(pathRef(comment.rel, comment.line, comment.endLine)),
		detail: clipText(sanitizeLine(comment.body), NOTICE_ROW_CHARS),
	}));
	return noticeMessage({
		content,
		details: {
			source: "code-review",
			title: `${plural(comments.length, "review comment")} sent`,
			severity: "info",
			items,
		},
	});
}
