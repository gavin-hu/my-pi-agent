/**
 * The tool-block frame: a status-colored left rail around a tool's own call or
 * result component.
 *
 * The resolver sets `renderShell: "self"`, so Pi draws no background box and no
 * padding; this frame supplies the indent, the rail, and the width math. The
 * inner component is the tool's existing renderer (or a generic fallback), so
 * syntax highlighting, diffs, previews, and truncation notices are preserved —
 * only the framing changes.
 *
 * The rail itself is the shared transcript rail (`lib/tui/rail.ts`), the same
 * one a notice and a subagent quote draw, so every railed block shares one left
 * edge. The call and the result are separate sibling components in the row, with
 * no spacer between them, so a rail drawn by each reads as one continuous rail.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { railLines } from "../../../lib/tui/rail.ts";
import { BLOCK_CONFIG, type BlockStatus } from "./config.ts";

/** The status a block draws with: running, failed, or finished cleanly. */
export function blockStatus(state: { isPartial: boolean; isError: boolean }): BlockStatus {
	return state.isPartial ? "info" : state.isError ? "bad" : "ok";
}

/**
 * Render `inner` behind the shared rail at the reduced width, painted by status.
 * `outputPad` indents the rail, and the rail's own rules — image passthrough and
 * the trailing-blank trim — come from `lib/tui/rail.ts`.
 */
export function toolBlockLines(
	inner: Component | undefined,
	status: BlockStatus,
	theme: Theme,
	width: number,
	outputPad: number,
	trimLeading = false,
): string[] {
	return railLines(inner, BLOCK_CONFIG.roles[status], theme, width, { indent: outputPad, trimLeading });
}

/** The rail frame Pi mounts in place of its background box for a tool row. */
export class ToolBlock implements Component {
	constructor(
		private readonly inner: Component | undefined,
		private readonly status: BlockStatus,
		private readonly theme: Theme,
		private readonly outputPad: number,
		/**
		 * Drop the component's own leading blank lines. Set for a `renderShell:
		 * "self"` tool (`edit`), whose `Box` pads itself top and bottom; without
		 * this the frame draws a bare rail above the call.
		 */
		private readonly trimLeading = false,
	) {}

	invalidate(): void {
		this.inner?.invalidate();
	}

	render(width: number): string[] {
		return toolBlockLines(this.inner, this.status, this.theme, Math.max(1, width), this.outputPad, this.trimLeading);
	}
}
