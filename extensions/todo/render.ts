/**
 * The `TodoResult` transcript block: the indented glyph rail over the todo list.
 *
 * `render` runs on every frame Pi draws, for every block in the transcript, so
 * the rail is memoized on the width (`RenderCache`) and rebuilt only when
 * `setInput` hands over a new list or `invalidate` says the theme moved.
 *
 * This module is on the registration path — the `todo` tool's `renderResult`
 * needs the class — while the `/todos` screen beside it is not.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { RenderCache } from "../../lib/tui/render-cache.ts";
import { todoRailLines, type TodoRailInput } from "./format.ts";

/**
 * Transcript result block: the indented glyph rail, wrapping at the render width.
 *
 * `render` runs on every frame Pi draws, for every block in the transcript, so the
 * rail is memoized on the width (`RenderCache`) and rebuilt only when
 * `setInput` hands over a new list or `invalidate` says the theme moved. The
 * caller must go through `setInput`: mutating a list in place would leave the
 * block showing what it drew last.
 */
export class TodoResult implements Component {
	private input: TodoRailInput;
	private theme: Theme;
	private readonly cache = new RenderCache();

	constructor(input: TodoRailInput, theme: Theme) {
		this.input = input;
		this.theme = theme;
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: TodoRailInput, theme: Theme): void {
		this.input = input;
		this.theme = theme;
		this.cache.invalidate();
	}

	invalidate(): void {
		this.cache.invalidate();
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.cache.lines(w, undefined, () => this.build(w));
	}

	private build(w: number): string[] {
		// The leading blank line separates the rail from the call header, matching
		// the built-ins' header/output gap.
		return ["", ...todoRailLines(this.input, this.theme, w)];
	}
}
