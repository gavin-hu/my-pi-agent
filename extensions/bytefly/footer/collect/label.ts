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
 * opt-in, so a session that never joined names nobody on the bar.
 *
 * Its caller loads this module on the first footer install rather than at registration,
 * because the read needs the bus's layout on disk and the registration graph is a budget in
 * `test/dependencies.test.ts` that may only fall.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	readSessionLabel,
	SESSION_LABEL_CHANNEL,
	type SessionLabelEvent,
	sessionIdOf,
} from "../../../../lib/session-label.ts";

/** What to draw: the label a join settled for this session. No record draws no chip at all. */
export type RosterLabelSink = (label: string) => void;

/** Following one transcript's label: the way to drop it, and when the record has been read. */
export interface LabelFollower {
	/**
	 * Drop the subscription — what a footer that installs under the next transcript calls first.
	 *
	 * A `/new` replaces the transcript inside one process, so an install is not a session: without
	 * this, every reset would leave a listener writing into the bar's one sink, and nothing would
	 * ever drop it.
	 */
	stop(): void;
	/** Resolves when the record has been read, so a caller can wait for the first drawn name. */
	ready: Promise<void>;
}

/**
 * Read this session's label once, then report every label the bus publishes for it.
 *
 * The subscription is here rather than beside the footer's other listeners because the
 * channel and the record walk are one contract, and only this module is deferred. The caller
 * owns the answer: Pi drops an extension's listeners when it unloads, and a `/new` does not
 * unload one, so the install that follows a reset drops the listener the previous one made.
 */
export function followRosterLabel(input: {
	pi: Pick<ExtensionAPI, "events">;
	ctx: Pick<ExtensionContext, "sessionManager" | "cwd">;
	agentDir: string;
	sink: RosterLabelSink;
}): LabelFollower {
	const { pi, ctx, agentDir, sink } = input;
	const own = sessionIdOf(ctx);
	if (own === undefined) return { stop: () => {}, ready: Promise.resolve() };
	const stop = pi.events.on(SESSION_LABEL_CHANNEL, (event) => {
		// The channel reaches every session in this process, and only one of them is this one:
		// a peer's label would put its name on this session's bar.
		const published = event as SessionLabelEvent | undefined;
		if (published === undefined || published.id !== own) return;
		sink(published.label);
	});
	// The record the bus wrote before this process started, if any — and the session's own directory,
	// which is what scopes the one-release legacy bus to this repository's records. A failure is the
	// same answer as no record: the bar names nobody.
	const ready = readSessionLabel(agentDir, own, { cwd: ctx.cwd }).then(
		(label) => {
			if (label !== undefined) sink(label);
		},
		() => {},
	);
	return { stop, ready };
}
