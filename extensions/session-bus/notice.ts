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

/**
 * A handoff is clipped far less generously, because it is an instruction and not a
 * notification: the card, its paths, and the step to take all sit past the point
 * where a message preview would have stopped. The inbox still holds the full text.
 */
const HANDOFF_PREVIEW = 800;

/** What a waking turn is told to do with a handoff: work it, not acknowledge it. */
const HANDOFF_HINT =
	"A handoff is work you now own: run `session inbox`, record the card's plan, and start it — the message names the two moves that wait on the lead, so do not just acknowledge it.";

/** `1 handoff`, `2 new messages` — a burst of handoffs is named as the work it is. */
function headlineOf(messages: readonly BusMessage[]): string {
	const count = messages.length;
	const handoffs = messages.filter((message) => message.kind === "handoff").length;
	if (handoffs === 0 || handoffs !== count) return `${count} new message${count === 1 ? "" : "s"}`;
	return `${count} handoff${count === 1 ? "" : "s"}`;
}

/** One message as a preview line: sender, kind, and the head of its text. */
function previewOf(message: BusMessage): string {
	const text = sanitizeLine(message.text);
	const limit = message.kind === "handoff" ? HANDOFF_PREVIEW : MAX_PREVIEW;
	const head = text.length > limit ? `${text.slice(0, limit)}…` : text;
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
 *
 * A `handoff` is the one kind that assigns work, so it is the one kind the text
 * treats as an instruction rather than as mail: the headline counts handoffs, the
 * preview keeps enough of the body to be actionable, and the hint says to start it and
 * leaves the two gates to the message, which is the only place that knows the lead's name.
 * Nothing else about the kind changes — it still does not block or wait for a reply.
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
	const headline = headlineOf(messages);
	return noticeMessage({
		content: burstText({
			marker: BUS_CONTEXT_MARKER,
			headline,
			lines: shown.map((message) => `- ${previewOf(message)}`),
			...(more > 0 ? { more: `… ${more} more` } : {}),
			hint: messages.some((message) => message.kind === "handoff")
				? HANDOFF_HINT
				: "Run `session inbox` to read and consume them.",
		}),
		details: { source: "session-bus", title: headline, items },
	});
}
