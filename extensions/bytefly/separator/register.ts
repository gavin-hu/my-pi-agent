/**
 * bytefly's turn separator: a labeled rule between completed turns.
 *
 * Pi has no built-in turn separator. On every fully settled agent run
 * (`agent_settled`, one per user turn) this appends an inert custom entry that
 * is excluded from LLM context, and a registered entry renderer draws it as a
 * centered `╌╌╌ turn N ╌╌╌` rule in the interactive transcript.
 *
 * `agent_settled` is deliberate: `turn_end` fires once per assistant message,
 * so tool-calling rounds would each get a line, while a settled run is exactly
 * one user turn.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPadStore, type PadSource } from "../pad.ts";
import { SeparatorComponent } from "./component.ts";
import { CONFIG } from "./config.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Count separators already on the branch, so numbering survives resume and fork. */
function countSeparators(entries: readonly { type: string; customType?: string }[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === CONFIG.customType) count++;
	}
	return count;
}

/** Register the separator renderer and append one on every settled turn. */
export function registerTurnSeparator(pi: ExtensionAPI, pad: PadSource = createPadStore()): void {
	pi.registerEntryRenderer<TurnSeparatorData>(CONFIG.customType, (entry, _options, theme) => {
		const turn = entry.data?.turn;
		if (typeof turn !== "number" || !Number.isFinite(turn)) return undefined;
		return new SeparatorComponent(turn, theme, pad.resolve());
	});

	pi.on("agent_settled", (_event, ctx) => {
		// The transcript is interactive-only; keep RPC/JSON/print sessions clean.
		if (ctx.mode !== "tui") return;
		const turn = countSeparators(ctx.sessionManager.getBranch()) + 1;
		pi.appendEntry<TurnSeparatorData>(CONFIG.customType, { turn });
	});
}
