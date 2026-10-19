/**
 * bytefly's turn separator: a labeled rule between completed turns.
 *
 * Pi has no built-in turn separator. On every fully settled agent run
 * (`agent_settled`, one per user turn) this appends an inert custom entry that
 * is excluded from LLM context, and a registered entry renderer draws it as a
 * centered `╌╌╌ turn N ╌╌╌` rule in the interactive transcript. The entry also
 * carries the run's receipt — duration, top-level tool count, failed tools, and
 * whether the user aborted it — so the rule can read as a flight log.
 *
 * `agent_settled` is deliberate: `turn_end` fires once per assistant message,
 * so tool-calling rounds would each get a line, while a settled run is exactly
 * one user turn. The run's first `agent_start` opens the receipt and later
 * starts (a retry or a continuation) stay in it, so the duration covers the
 * whole settled run rather than one attempt.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPadStore, type PadSource } from "../pad.ts";
import { SeparatorComponent } from "./component.ts";
import { CONFIG } from "./config.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Host seams, injected by tests so the duration is deterministic. */
export interface SeparatorDeps {
	/** The clock the duration is read from. */
	now?: () => number;
}

/** Count separators already on the branch, so numbering survives resume and fork. */
function countSeparators(entries: readonly { type: string; customType?: string }[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === CONFIG.customType) count++;
	}
	return count;
}

/** Register the separator renderer and append one on every settled turn. */
export function registerTurnSeparator(
	pi: ExtensionAPI,
	pad: PadSource = createPadStore(),
	deps: SeparatorDeps = {},
): void {
	const now = deps.now ?? (() => Date.now());
	// The current run's receipt. `startedAt` is the first `agent_start`; the
	// counters span every top-level tool in the settled run.
	let startedAt: number | undefined;
	let tools = 0;
	let failures = 0;

	const reset = (): void => {
		startedAt = undefined;
		tools = 0;
		failures = 0;
	};

	pi.registerEntryRenderer<TurnSeparatorData>(CONFIG.customType, (entry, _options, theme) => {
		const data = entry.data;
		if (!data || typeof data.turn !== "number" || !Number.isFinite(data.turn)) return undefined;
		return new SeparatorComponent(data, theme, pad.resolve());
	});

	pi.on("agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || startedAt !== undefined) return;
		startedAt = now();
		tools = 0;
		failures = 0;
	});

	// A nested tool is an implementation detail of its parent, not a transcript
	// block, so it neither counts nor contributes a failure.
	pi.on("tool_execution_start", (event) => {
		if (startedAt === undefined || event.parentToolCallId) return;
		tools += 1;
	});

	pi.on("tool_execution_end", (event) => {
		if (startedAt === undefined || event.parentToolCallId || !event.isError) return;
		failures += 1;
	});

	pi.on("agent_settled", (event, ctx) => {
		// The transcript is interactive-only; keep RPC/JSON/print sessions clean.
		if (ctx.mode !== "tui") {
			reset();
			return;
		}
		const turn = countSeparators(ctx.sessionManager.getBranch()) + 1;
		const data: TurnSeparatorData = { turn };
		if (startedAt !== undefined) {
			data.durationMs = Math.max(0, now() - startedAt);
			if (tools > 0) data.tools = tools;
			if (failures > 0) data.failures = failures;
		}
		if (event.aborted) data.aborted = true;
		pi.appendEntry<TurnSeparatorData>(CONFIG.customType, data);
		reset();
	});

	pi.on("session_shutdown", () => reset());
}
