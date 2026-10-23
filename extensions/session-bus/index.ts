/**
 * session-bus — coordinate parallel Pi sessions on one repository.
 *
 * A terminal session joins on `session_start`; RPC, JSON, print, and WeChat peer
 * sessions join only when the tool or `/sessions` is used. The factory only
 * registers; the runtime owns the heartbeat and removes the registry entry on
 * shutdown. Nothing arms an inbox watch by itself, so delivery stays pull-based
 * until a session asks: with the watch armed, mail that arrived while the agent
 * was idle raises one turn (`wake`) or is reported at the next one.
 *
 * Load with:  pi --extension ./extensions/session-bus
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { burstText, noticeMessage, type NoticeItem, type NoticeMessage } from "../../lib/notice.ts";
import { createPendingReporter, registerPendingChannel } from "../../lib/report.ts";
import { registerCommands } from "./commands.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { BusMessage } from "./types.ts";

/** Marker embedded in the injected mail context. */
const BUS_CONTEXT_MARKER = "[SESSION BUS]";

/** At most this many messages are previewed in one notice. */
const MAX_NOTICE_MESSAGES = 5;

/** A message body is clipped to this many characters in a preview. */
const MAX_PREVIEW = 200;

/** One message as a preview line: sender, kind, and the head of its text. */
function previewOf(message: BusMessage): string {
	const text = sanitizeLine(message.text);
	const head = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
	const paths = message.paths?.length ? ` (${message.paths.map((path) => sanitizeLine(path)).join(", ")})` : "";
	return `${sanitizeLine(message.fromLabel)} · ${sanitizeLine(message.kind)} · ${head}${paths}`;
}

/** The shared notice for pending mail: model text plus renderer details. */
function mailNotice(messages: BusMessage[]): NoticeMessage {
	const count = messages.length;
	const shown = messages.slice(0, MAX_NOTICE_MESSAGES);
	const more = count - shown.length;
	const items: NoticeItem[] = shown.map((message) => ({
		label: `${sanitizeLine(message.fromLabel)} · ${sanitizeLine(message.kind)}`,
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

export interface SessionBusDeps {
	/** Test seam: a runtime with a temp dir and fixed clock. */
	bus?: SessionBus;
}

export default function sessionBus(pi: ExtensionAPI, deps: SessionBusDeps = {}): void {
	if (!isExtensionEnabled("session-bus")) return;
	const bus = deps.bus ?? createSessionBus(pi);

	const reporter = createPendingReporter<BusMessage>({
		wake: (notice) => pi.sendMessage(notice, { triggerTurn: true }),
		pending: () => bus.pending(),
		markReported: (messages) => bus.markReported(messages.map((message) => message.id)),
		buildNotice: mailNotice,
		source: "session-bus",
	});

	registerTools(pi, bus);
	registerCommands(pi, bus);

	registerPendingChannel(pi, {
		reporter,
		runtime: {
			// A start failure is reported once and leaves the runtime retryable: the next
			// tool call starts it again, and a bus that never started simply never polls.
			load: async (ctx) => {
				try {
					await bus.start(ctx);
				} catch (error) {
					ctx.ui.notify(`Session bus did not start: ${messageOf(error)}`, "warning");
				}
			},
			shutdown: () => bus.stop(),
		},
		// A reload or a replaced session reuses the runtime, so the mail trigger is
		// armed on every session start and cleared before the runtime releases.
		onSessionStart: () => {
			bus.onWake = () => reporter.report();
		},
		onSessionShutdown: () => {
			bus.onWake = undefined;
		},
	});
}
