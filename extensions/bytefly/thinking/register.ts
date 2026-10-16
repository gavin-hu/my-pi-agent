/**
 * bytefly's live thinking counter.
 *
 * Pi's hidden thinking block is a static italic `Thinking...` and its working
 * row is a static `Working`; neither says how long the model has been reasoning.
 * This surface advances both once a second while an assistant message streams,
 * so a long think is legible at a glance, and restores Pi's defaults when the
 * message ends.
 *
 * The count is scoped to one assistant message rather than the whole run:
 * `message_start` … `message_end`. That keeps the label honest through a long
 * tool call, where nothing is being thought, and it leaves the historical
 * thinking blocks Pi relabels globally showing their plain `Thinking...` again
 * once the current message settles.
 *
 * Both handles are global (`setHiddenThinkingLabel` rewrites every thinking
 * block, `setWorkingMessage` the single working row), so the tick is cancelled
 * and both are reset on end and, belt and braces, on `session_shutdown` — the
 * factory itself only registers.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { THINKING_CONFIG } from "./config.ts";
import { thinkingCounter, workingCounter } from "./format.ts";

/** Host seams, injected by tests so the tick is deterministic. */
export interface ThinkingDeps {
	/** The clock the count is read from. */
	now?: () => number;
	/** Start the repeating tick; returns a cancel handle. */
	schedule?: (tick: () => void, intervalMs: number) => () => void;
}

/** A repeating timer that never holds the process open on its own. */
function defaultSchedule(tick: () => void, intervalMs: number): () => void {
	const timer = setInterval(tick, intervalMs);
	(timer as { unref?: () => void }).unref?.();
	return () => clearInterval(timer);
}

/** Register the counter; it runs only in interactive (`tui`) sessions. */
export function registerThinkingTimer(pi: ExtensionAPI, deps: ThinkingDeps = {}): void {
	const now = deps.now ?? (() => Date.now());
	const schedule = deps.schedule ?? defaultSchedule;
	let cancel: (() => void) | undefined;
	let startedAt = 0;
	// A boolean, not `startedAt === 0`: an injected clock is allowed to start at 0.
	let active = false;

	/** Stop the tick and hand both surfaces back to Pi. Idempotent. */
	const stop = (ctx: ExtensionContext): void => {
		cancel?.();
		cancel = undefined;
		if (!active) return;
		active = false;
		ctx.ui.setHiddenThinkingLabel(undefined);
		ctx.ui.setWorkingMessage(undefined);
	};

	pi.on("message_start", (event, ctx) => {
		if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
		stop(ctx);
		startedAt = now();
		active = true;
		const tick = (): void => {
			const elapsed = now() - startedAt;
			ctx.ui.setHiddenThinkingLabel(thinkingCounter(elapsed));
			ctx.ui.setWorkingMessage(workingCounter(elapsed));
		};
		tick();
		cancel = schedule(tick, THINKING_CONFIG.intervalMs);
	});

	pi.on("message_end", (event, ctx) => {
		if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
		stop(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
