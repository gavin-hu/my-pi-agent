/**
 * The `WatchResult` transcript block: the `watch` tool's list-or-matches result.
 *
 * It wraps the shared `TailResult` kit over the `/watch`-style row rail, so the
 * tool's `renderResult` stays a few lines and every row is drawn by `watchRow`
 * in `format.ts`. The `/watch` screen draws the same rows through that helper;
 * this module is on the registration path, and the screen is not.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { TailResult, type TailResultInput } from "../../lib/tui/tool.ts";
import { watchRow } from "./format.ts";
import type { WatchRecord } from "./types.ts";

/** Input for the transcript result: a themed watcher list or a matched-line tail. */
export type WatchResultInput =
	| { kind: "list"; watches: WatchRecord[]; more: number }
	| { kind: "lines"; label: string; lines: string[]; earlier: number };

/** Map the watch vocabulary onto the shared transcript tail block. */
function watchTail(input: WatchResultInput): TailResultInput<WatchRecord> {
	if (input.kind === "lines") {
		return { kind: "lines", lines: input.lines, earlier: input.earlier, earlierLabel: input.label };
	}
	return {
		kind: "list",
		rows: input.watches,
		more: input.more,
		rowLine: (watch, width, theme) => watchRow(watch, theme, width, { marker: false }),
	};
}

/**
 * Transcript result block for the `watch` tool: the shared tail block over the
 * `/watch`-style row rail or the themed matched-line tail. Reused across renders.
 */
export class WatchResult implements Component {
	private readonly view: TailResult<WatchRecord>;

	constructor(input: WatchResultInput, theme: Theme) {
		this.view = new TailResult(watchTail(input), theme);
	}

	/** Update in place so the transcript can reuse this component across renders. */
	setInput(input: WatchResultInput, theme: Theme): void {
		this.view.setInput(watchTail(input), theme);
	}

	invalidate(): void {
		this.view.invalidate();
	}

	render(width: number): string[] {
		return this.view.render(width);
	}
}
