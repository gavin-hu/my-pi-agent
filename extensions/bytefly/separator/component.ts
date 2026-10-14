/**
 * The transcript component that draws one separator entry.
 *
 * It is stateless: the line is derived from the stored turn number and the
 * width passed to `render`, so there is nothing to invalidate.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { separatorLine } from "./format.ts";

/** Renders one separator entry; `turn` comes from the stored entry data. */
export class SeparatorComponent implements Component {
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
