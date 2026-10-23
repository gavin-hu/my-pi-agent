/**
 * The mail notice: what the model reads when an armed session has new mail, and
 * the rows bytefly draws from the same burst.
 *
 * The message bodies came from another session, so they are sanitized here before
 * they reach either audience.
 */

import { sanitizeLine } from "../../lib/format.ts";
import { burstText, noticeMessage, type NoticeItem, type NoticeMessage } from "../../lib/notice.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import type { BusMessage } from "./types.ts";

/** Marker embedded in the injected mail context. */
const BUS_CONTEXT_MARKER = "[SESSION BUS]";

/** Messages previewed in the model-facing text. The renderer shows its own cap. */
const MAX_NOTICE_LINES = 5;

/** A message body is clipped to this many characters in a preview. */
const MAX_PREVIEW = 200;

/** One message as a preview line: sender, kind, and the head of its text. */
function previewOf(message: BusMessage): string {
	const text = sanitizeLine(message.text);
	const head = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
	const paths = message.paths?.length ? ` (${message.paths.map((path) => sanitizeLine(path)).join(", ")})` : "";
	return `${sanitizeLine(message.fromLabel)}${SEPARATORS.item}${sanitizeLine(message.kind)}${SEPARATORS.item}${head}${paths}`;
}

/**
 * The shared notice for pending mail: model text plus renderer details.
 *
 * The model reads five lines, so a burst stays bounded in its context; every
 * message is passed to the renderer, whose own cap draws the `… N more` row. The
 * two caps are deliberately separate — one is a context budget, the other a
 * screen height.
 */
export function mailNotice(messages: BusMessage[]): NoticeMessage {
	const count = messages.length;
	const shown = messages.slice(0, MAX_NOTICE_LINES);
	const more = count - shown.length;
	const items: NoticeItem[] = messages.map((message) => ({
		label: `${sanitizeLine(message.fromLabel)}${SEPARATORS.item}${sanitizeLine(message.kind)}`,
		detail: sanitizeLine(message.text).slice(0, MAX_PREVIEW),
		severity: message.kind === "event" ? "warn" : "info",
	}));
	return noticeMessage({
		content: burstText({
			marker: BUS_CONTEXT_MARKER,
			headline: `${count} new message${count === 1 ? "" : "s"}`,
			lines: shown.map((message) => `- ${previewOf(message)}`),
			...(more > 0 ? { more: `… ${more} more` } : {}),
			hint: "Run `session inbox` to read and consume them.",
		}),
		details: { source: "session-bus", title: `${count} new message${count === 1 ? "" : "s"}`, items },
	});
}
