/**
 * watch — tail a file or command output and alert on pattern matches.
 *
 * Registers the `watch` tool and `/watch` command. Watchers read a file or a
 * command's merged output, match each new line against a regular expression,
 * and alert the user; matching lines are reported to the model — and shown as a
 * bytefly notice — at the next turn, or wake a turn immediately when the
 * watcher opted into `wake`. Watchers are session-only and stopped on shutdown.
 *
 * Load with:  pi --extension ./extensions/watch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { WATCH_MATCH_CHANNEL, type WatchMatchEvent } from "../../lib/events.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { noticeMessage, type NoticeMessage } from "../../lib/notice.ts";
import { createPendingReporter } from "../../lib/report.ts";
import { registerCommands } from "./commands.ts";
import { clipLabel } from "../../lib/tui/columns.ts";
import { formatPendingMatch } from "./format.ts";
import { createWatchRuntime, type WatchRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { PendingMatch } from "./types.ts";

/** Marker embedded in the injected match context. */
const WATCH_CONTEXT_MARKER = "[WATCH MATCHES]";

/** At most this many match lines are injected in one message. */
const MAX_CONTEXT_MATCHES = 20;

/** Build the model-facing text for the pending-match notice. */
export function buildWatchContext(matches: PendingMatch[]): string {
	const shown = matches.slice(0, MAX_CONTEXT_MATCHES);
	const lines = shown.map(formatPendingMatch);
	const more = matches.length - shown.length;
	const suffix = more > 0 ? `\n… ${more} more match${more === 1 ? "" : "es"}` : "";
	return `${WATCH_CONTEXT_MARKER}\n${matches.length} watched line${matches.length === 1 ? "" : "s"} matched:\n${lines.join("\n")}${suffix}\nRead more with \`watch matches <id>\`.`;
}

/** The shared notice for pending matches: model text plus renderer details. */
function watchNotice(matches: PendingMatch[]): NoticeMessage {
	const count = matches.length;
	return noticeMessage({
		content: buildWatchContext(matches),
		details: {
			source: "watch",
			title: `${count} watched line${count === 1 ? "" : "s"} matched`,
			items: matches.slice(0, MAX_CONTEXT_MATCHES).map((match) => ({
				label: `${match.watcherId} ${clipLabel(match.label)}`,
				detail: sanitizeLine(match.line),
				severity: "warn",
			})),
		},
	});
}

export interface WatchDeps {
	/** Overridable runtime, so tests can drive matches without a real tail. */
	runtime?: WatchRuntime;
}

export default function watch(pi: ExtensionAPI, deps: WatchDeps = {}): void {
	if (!isExtensionEnabled("watch")) return;
	const runtime = deps.runtime ?? createWatchRuntime();

	// Opt-in wake: a `wake` watcher matched while the agent is idle. The reporter
	// reports *all* pending matches, not just the waking one, so a non-wake match
	// is not silently dropped.
	const reporter = createPendingReporter<PendingMatch>({
		wake: (notice) => pi.sendMessage(notice, { triggerTurn: true }),
		pending: () => runtime.pendingMatches(),
		markReported: (matches) => runtime.markReported(matches),
		buildNotice: watchNotice,
		source: "watch",
		// A wake means the user is away from the terminal, so the alert also leaves
		// the process. bytefly's notify capability owns delivery; this publishes the
		// fact and never learns how it is sent. The newest match is the one an alert
		// is about, while the count covers the whole cycle.
		onWoke: (matches) => {
			const newest = matches[matches.length - 1];
			if (!newest) return;
			try {
				const event: WatchMatchEvent = {
					count: matches.length,
					watcherId: newest.watcherId,
					label: newest.label,
					line: newest.line,
				};
				pi.events.emit(WATCH_MATCH_CHANNEL, event);
			} catch {
				// A throwing listener must not cost the wake that already happened.
			}
		},
	});

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	pi.on("session_start", (_event, ctx) => {
		reporter.sessionStart();
		runtime.load(ctx);
		// `shutdown` clears this; a reload or session replacement reuses the
		// runtime, so re-arm it on every session start.
		runtime.onMatch = () => reporter.report();
	});

	// Tree navigation does not change the watcher table; only repaint.
	pi.on("session_tree", (_event, ctx) => {
		runtime.setStatus(ctx);
	});

	pi.on("agent_start", () => {
		reporter.agentStart();
	});
	pi.on("agent_settled", () => {
		reporter.agentSettled();
	});

	// Report matches to the model at the start of the next turn.
	pi.on("before_agent_start", (_event, ctx) => {
		const reported = reporter.beforeAgentStart();
		if (!reported) return undefined;
		runtime.setStatus(ctx);
		return reported;
	});

	// Keep stale match notices out of later turns. Only this extension's notices
	// are pruned; another source's are left for its own handler.
	pi.on("context", (event) => reporter.filterContext(event.messages));

	// `shutdown` detaches the UI controller, which clears both chips.
	pi.on("session_shutdown", async () => {
		runtime.onMatch = undefined;
		await runtime.shutdown();
	});
}
