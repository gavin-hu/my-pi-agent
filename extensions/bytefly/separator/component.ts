/**
 * The transcript component that draws one separator entry.
 *
 * `render` runs on every frame Pi draws, and a session holds one separator per
 * turn, so the line is a pure function of the stored entry data, the width, and
 * the theme it was built with. `centeredRule` paints and measures a full-width
 * rule, so the placed line is memoized on the width (`RenderCache`); without it
 * a long session rebuilds every turn's rule on every frame. Pi rebuilds the
 * component from the renderer on a theme change (its
 * `CustomEntryComponent.invalidate` re-runs it), so the captured theme cannot go
 * stale; `invalidate` drops the memo anyway, in case that changes.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { RenderCache } from "../../../lib/tui/render-cache.ts";
import { separatorLine } from "./format.ts";
import type { TurnSeparatorData } from "./types.ts";

/** Renders one separator entry; the data comes from the stored entry. */
export class SeparatorComponent implements Component {
	private readonly cache = new RenderCache();

	constructor(
		private readonly data: TurnSeparatorData,
		private readonly theme: Theme,
		private readonly pad = 0,
	) {}

	invalidate(): void {
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.cache.lines(w, undefined, () => separatorLine(this.data, w, this.theme, this.pad));
	}
}
