/**
 * watch — tail a file or command output and alert on pattern matches.
 *
 * Registers the `watch` tool and `/watch` command. Watchers read a file or a
 * command's merged output, match each new line against a regular expression,
 * and alert the user; matching lines are reported to the model at the next
 * turn, or wake a turn immediately when the watcher opted into `wake`. Watchers
 * are session-only and stopped on shutdown.
 *
 * Load with:  pi --extension ./extensions/watch
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { STATUS_KEYS } from "../../lib/ui.ts";
import { registerCommands } from "./commands.ts";
import { formatPendingMatch } from "./format.ts";
import { createWatchRuntime, type WatchRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { PendingMatch } from "./types.ts";

/** Marker embedded in the injected match context. */
const WATCH_CONTEXT_MARKER = "[WATCH MATCHES]";

/** Custom-entry type used for the injected match message. */
export const WATCH_CONTEXT_TYPE = "watch-context";

/** At most this many match lines are injected in one message. */
const MAX_CONTEXT_MATCHES = 20;

/** Build the hidden context injected for pending matches. */
export function buildWatchContext(matches: PendingMatch[]): string {
	const shown = matches.slice(0, MAX_CONTEXT_MATCHES);
	const lines = shown.map(formatPendingMatch);
	const more = matches.length - shown.length;
	const suffix = more > 0 ? `\n… ${more} more match${more === 1 ? "" : "es"}` : "";
	return `${WATCH_CONTEXT_MARKER}\n${matches.length} watched line${matches.length === 1 ? "" : "s"} matched:\n${lines.join("\n")}${suffix}\nRead more with \`watch matches <id>\`.`;
}

function isWatchContext(message: AgentMessage): boolean {
	return (message as AgentMessage & { customType?: string }).customType === WATCH_CONTEXT_TYPE;
}

export interface WatchDeps {
	/** Overridable runtime, so tests can drive matches without a real tail. */
	runtime?: WatchRuntime;
}

export default function watch(pi: ExtensionAPI, deps: WatchDeps = {}): void {
	if (!isExtensionEnabled("watch")) return;
	const runtime = deps.runtime ?? createWatchRuntime();
	let busy = false;
	let waking = false;

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Opt-in wake: a `wake` watcher matched while the agent is idle. Report *all*
	// pending matches, not just the waking one, so a non-wake match is not
	// silently dropped. `waking` guards the window before `agent_start` fires.
	const handleMatch = (): void => {
		if (busy || waking) return;
		const pending = runtime.pendingMatches();
		if (pending.length === 0) return;
		try {
			pi.sendMessage(
				{ customType: WATCH_CONTEXT_TYPE, content: buildWatchContext(pending), display: false },
				{ triggerTurn: true },
			);
			runtime.markReported(pending);
			waking = true;
		} catch {
			// Waking is best-effort; the next turn still reports the matches.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		busy = false;
		waking = false;
		runtime.load(ctx);
		// `shutdown` clears this; a reload or session replacement reuses the
		// runtime, so re-arm it on every session start.
		runtime.onMatch = handleMatch;
	});

	// Tree navigation does not change the watcher table; only repaint.
	pi.on("session_tree", (_event, ctx) => {
		runtime.setStatus(ctx);
	});

	pi.on("agent_start", () => {
		busy = true;
	});
	pi.on("agent_settled", () => {
		busy = false;
		waking = false;
	});

	// Report matches to the model at the start of the next turn.
	pi.on("before_agent_start", (_event, ctx) => {
		const pending = runtime.pendingMatches();
		if (pending.length === 0) return undefined;
		runtime.markReported(pending);
		runtime.setStatus(ctx);
		return {
			message: { customType: WATCH_CONTEXT_TYPE, content: buildWatchContext(pending), display: false },
		};
	});

	// Keep stale match notes out of later turns.
	pi.on("context", (event) => {
		const contexts = event.messages.filter(isWatchContext);
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isWatchContext(message) || message === last) };
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		runtime.onMatch = undefined;
		await runtime.shutdown();
		try {
			ctx.ui.setStatus(STATUS_KEYS.watch, undefined);
			ctx.ui.setStatus(STATUS_KEYS.watchMatches, undefined);
		} catch {
			// UI may already be gone.
		}
	});
}
