/**
 * turn-separator — a labeled dashed line between completed turns.
 *
 * Pi has no built-in turn separator. On every fully settled agent run
 * (`agent_settled`, one per user turn), this appends an inert custom entry that
 * is excluded from LLM context. A registered entry renderer draws it as a
 * centered `╌╌╌ turn N ╌╌╌` rule in the interactive transcript.
 *
 * `agent_settled` is deliberate: `turn_end` fires once per assistant message,
 * so tool-calling rounds would each get a line, while a settled run is exactly
 * one user turn.
 *
 * Load with:  pi --extension ./extensions/turn-separator
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { CONFIG } from "./config.ts";
import { separatorLine } from "./format.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Renders one separator entry; `turn` comes from the stored entry data. */
class SeparatorComponent implements Component {
	constructor(
		private readonly turn: number,
		private readonly theme: Theme,
	) {}

	invalidate(): void {
		// Stateless: the line is derived from `turn` and the width passed to render.
	}

	render(width: number): string[] {
		return separatorLine(this.turn, width, this.theme);
	}
}

/** Count separators already on the branch, so numbering survives resume and fork. */
function countSeparators(entries: readonly { type: string; customType?: string }[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === CONFIG.customType) count++;
	}
	return count;
}

export default function turnSeparator(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<TurnSeparatorData>(CONFIG.customType, (entry, _options, theme) => {
		const turn = entry.data?.turn;
		if (typeof turn !== "number" || !Number.isFinite(turn)) return undefined;
		return new SeparatorComponent(turn, theme);
	});

	pi.on("agent_settled", (_event, ctx) => {
		// The transcript is interactive-only; keep RPC/JSON/print sessions clean.
		if (ctx.mode !== "tui") return;
		const turn = countSeparators(ctx.sessionManager.getBranch()) + 1;
		pi.appendEntry<TurnSeparatorData>(CONFIG.customType, { turn });
	});
}
