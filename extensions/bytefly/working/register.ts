/**
 * bytefly's live working line.
 *
 * Pi's working indicator shows a static `Working`, so a long run reads the same as
 * a short one. This surface advances the message once a second while the indicator
 * is up, and hands it back to Pi when it comes down. Once a top-level tool starts,
 * the message also counts this run's tools, turning the line on the composer's top
 * border into `working · 3 tools · 12s`.
 *
 * The timer is tied to the indicator's visibility. The host shows it in its own
 * `turn_start` handler and clears it at `agent_end` (`interactive-mode.js`), so the
 * tick starts at `turn_start` and stops at `agent_end` — the two moments it appears
 * and disappears. Turns inside one run do not restart it: the host leaves the same
 * indicator up across turns, and `start` is a no-op while it is counting.
 *
 * A nested tool call (one carrying `parentToolCallId`, such as a codemode
 * script's inner call) is not counted, so the number matches the tool blocks the
 * transcript shows. The tool events repaint the line immediately; the one-second
 * tick is still the only timer.
 *
 * Compaction and auto-retry also replace the indicator, but both run outside this
 * window (`auto_retry_start` follows `agent_end`; the before-settle compaction
 * runs after it), and neither is an extension event, so there is nothing to
 * hook and nothing to undo.
 *
 * The handle is global (`setWorkingMessage` drives the single indicator), so the
 * tick is cancelled and the message reset on stop and, belt and braces, on
 * `session_shutdown` — the factory itself only registers.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultInterval } from "../../../lib/timer.ts";
import { WORKING_CONFIG } from "./config.ts";
import { workingCounter } from "./format.ts";

/** Host seams, injected by tests so the tick is deterministic. */
export interface WorkingDeps {
	/** The clock the count is read from. */
	now?: () => number;
	/** Start the repeating tick; returns a cancel handle. */
	schedule?: (tick: () => void, intervalMs: number) => () => void;
}

/** Register the timer; it runs only in interactive (`tui`) sessions. */
export function registerWorkingTimer(pi: ExtensionAPI, deps: WorkingDeps = {}): void {
	const now = deps.now ?? (() => Date.now());
	const schedule = deps.schedule ?? ((tick, intervalMs) => defaultInterval(intervalMs, tick));
	let cancel: (() => void) | undefined;
	let startedAt = 0;
	// A boolean, not `startedAt === 0`: an injected clock is allowed to start at 0.
	let active = false;
	// How many top-level tools this run has started. Reset with the run.
	let tools = 0;

	/** The current line's text, from the run state and the elapsed time. */
	const message = (): string => workingCounter(now() - startedAt, { tools });

	/** Repaint an active line now, so a tool start does not wait for the next tick. */
	const refresh = (ctx: ExtensionContext): void => {
		if (active) ctx.ui.setWorkingMessage(message());
	};

	/** Stop the tick and hand the working message back to Pi. Idempotent. */
	const stop = (ctx: ExtensionContext): void => {
		cancel?.();
		cancel = undefined;
		if (!active) return;
		active = false;
		tools = 0;
		ctx.ui.setWorkingMessage(undefined);
	};

	/** Start the count for the current turn; a no-op while already counting. */
	const start = (ctx: ExtensionContext): void => {
		if (active) return;
		startedAt = now();
		active = true;
		tools = 0;
		const tick = (): void => {
			ctx.ui.setWorkingMessage(message());
		};
		tick();
		cancel = schedule(tick, WORKING_CONFIG.intervalMs);
	};

	// The host shows the working indicator on its own `turn_start` handler, so
	// this is the first frame the indicator is up.
	pi.on("turn_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		start(ctx);
	});

	// A nested tool is an implementation detail of its parent run, not a
	// transcript block, so it does not count toward the line.
	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx.mode !== "tui" || !active || event.parentToolCallId) return;
		tools += 1;
		refresh(ctx);
	});

	// The host clears the working indicator at `agent_end`.
	pi.on("agent_end", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		stop(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
