/**
 * bytefly's notify capability: OS notifications for unattended runs.
 *
 * Three triggers, each gated by its own `notify.*` flag in `bytefly.json`:
 *
 * - a settled agent run (`agent_settled`) — Pi finished and waits for the next
 *   message; an aborted run is skipped because the user is at the keyboard;
 * - a prompt opened while a run is active (`ui_prompt_start`) — the agent is
 *   asking for input. A prompt while idle is a command the user typed, so it
 *   does not fire;
 * - a finished background job, announced by the `job` extension on
 *   {@link JOB_FINISHED_CHANNEL}; and a `watch` wake match, announced by the
 *   `watch` extension on {@link WATCH_MATCH_CHANNEL}. The three extensions never
 *   import each other; the bus and its payload are the whole contract.
 *
 * The config is read at `session_start` and the bus subscription is a
 * long-lived resource, so it is created there too and released in an
 * idempotent `session_shutdown` (the factory itself only registers).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	JOB_FINISHED_CHANNEL,
	type JobFinishedEvent,
	WATCH_MATCH_CHANNEL,
	type WatchMatchEvent,
} from "../../../lib/events.ts";
import { DEFAULT_NOTIFY_CONFIG, loadNotifyConfig } from "./config.ts";
import { defaultSeams, type NotifySeams, sendNotification } from "./dispatch.ts";
import { formatInputBody, formatJobBody, formatTurnBody, formatWatchBody, sessionLabel } from "./format.ts";
import type { NotifyConfig } from "./types.ts";

/** Host seams, injected by tests. */
export interface NotifyDeps {
	/** Replace the process/platform/stdout/execFile seams entirely. */
	seams?: NotifySeams;
}

/** Narrow an untrusted bus payload to a job completion. */
function isJobFinished(value: unknown): value is JobFinishedEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<JobFinishedEvent>;
	return typeof event.id === "string" && typeof event.label === "string" && typeof event.status === "string";
}

/** Narrow an untrusted bus payload to a wake match. */
function isWatchMatch(value: unknown): value is WatchMatchEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<WatchMatchEvent>;
	return (
		typeof event.count === "number" &&
		typeof event.watcherId === "string" &&
		typeof event.label === "string" &&
		typeof event.line === "string"
	);
}

/** Register the notification triggers. */
export function registerNotify(pi: ExtensionAPI, deps: NotifyDeps = {}): void {
	const seams = deps.seams ?? defaultSeams();
	let config: NotifyConfig = DEFAULT_NOTIFY_CONFIG;
	let busy = false;
	/** Bus subscriptions: one per emitting extension, all created at session start. */
	const unsubscribes: Array<() => void> = [];

	const fire = (body: string): void => {
		sendNotification(config, config.title, body, seams);
	};

	const session = (ctx: ExtensionContext): string => sessionLabel(ctx.sessionManager.getSessionName(), ctx.cwd);

	// A run is "busy" only between `agent_start` and `agent_settled`, which is what
	// tells an agent prompt (needs input) from a user command's prompt.
	pi.on("agent_start", () => {
		busy = true;
	});

	pi.on("session_start", (_event, ctx) => {
		config = loadNotifyConfig(ctx.cwd);
		busy = false;
		while (unsubscribes.length > 0) unsubscribes.pop()?.();
		unsubscribes.push(
			pi.events.on(JOB_FINISHED_CHANNEL, (data) => {
				if (!config.jobFinished || !isJobFinished(data)) return;
				fire(formatJobBody(data));
			}),
			pi.events.on(WATCH_MATCH_CHANNEL, (data) => {
				if (!config.matchFound || !isWatchMatch(data)) return;
				fire(formatWatchBody(data));
			}),
		);
	});

	pi.on("agent_settled", (event, ctx) => {
		busy = false;
		if (event.aborted || !config.turnFinished) return;
		fire(formatTurnBody(session(ctx)));
	});

	pi.on("ui_prompt_start", (event, ctx) => {
		if (!busy || !config.needsInput) return;
		fire(formatInputBody(event.kind, event.title, session(ctx)));
	});

	pi.on("session_shutdown", () => {
		while (unsubscribes.length > 0) unsubscribes.pop()?.();
		busy = false;
	});
}
