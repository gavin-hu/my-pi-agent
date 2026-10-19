/**
 * The transcript component that draws one separator entry.
 *
 * It is stateless: the line is derived from the stored entry data and the width
 * passed to `render`, so there is nothing to invalidate.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { separatorLine } from "./format.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Renders one separator entry; the data comes from the stored entry. */
export class SeparatorComponent implements Component {
	constructor(
		private readonly data: TurnSeparatorData,
		private readonly theme: Theme,
		private readonly pad = 0,
	) {}

	invalidate(): void {
		// Stateless: the line is derived from the data and the width passed to render.
	}

	render(width: number): string[] {
		return separatorLine(this.data, width, this.theme, this.pad);
	}
}
