/**
 * Following this session's roster label, for the bar.
 *
 * The footer renders on a frame timer, so the label cannot be a bus read per frame. It is
 * one read of the record the bus wrote — a resumed pane can already have one — and a
 * subscription to `SESSION_LABEL_CHANNEL` for every label the bus settles afterwards. Both
 * report through the sink the footer handed in, so the renderer reads one field and the I/O
 * happens once.
 *
 * No record is the ordinary answer, not a failure: bytefly is on by default and the bus is
 * opt-in, so a session that never joined keeps Pi's own name.
 *
 * Its caller loads this module on the first footer install rather than at registration,
 * because the read needs the bus's layout on disk and the registration graph is a budget in
 * `test/dependencies.test.ts` that may only fall.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SESSION_LABEL_CHANNEL, type SessionLabelEvent, sessionIdOf } from "../../../../lib/session-label.ts";
import { readSessionLabel } from "../../../../lib/session-roster.ts";

/** What to draw: the label, or `null` for "no record, keep Pi's session name". */
export type RosterLabelSink = (label: string | null) => void;

/**
 * Read this session's label once, then report every label the bus publishes for it.
 *
 * The subscription is here rather than beside the footer's other listeners because the
 * channel and the record walk are one contract, and only this module is deferred. It is
 * never unsubscribed: Pi drops an extension's listeners when it unloads, and a footer that
 * re-installs (a session tree change) is the same session under the same label.
 *
 * Answers when the record has been read, so a caller can wait for the first frame that
 * draws a label rather than guess at a timer.
 */
export function followRosterLabel(input: {
	pi: Pick<ExtensionAPI, "events">;
	ctx: Pick<ExtensionContext, "sessionManager">;
	agentDir: string;
	sink: RosterLabelSink;
}): Promise<void> {
	const { pi, ctx, agentDir, sink } = input;
	const own = sessionIdOf(ctx);
	if (own === undefined) return Promise.resolve();
	pi.events.on(SESSION_LABEL_CHANNEL, (event) => {
		// The channel reaches every session in this process, and only one of them is this one:
		// a peer's label would put its name on this session's bar.
		const published = event as SessionLabelEvent | undefined;
		if (published === undefined || published.id !== own) return;
		sink(published.label);
	});
	// The record the bus wrote before this process started, if any. A failure is the same
	// answer as no record: the bar keeps Pi's own name.
	return readSessionLabel(agentDir, own).then(
		(label) => {
			if (label !== undefined) sink(label);
		},
		() => {},
	);
}
