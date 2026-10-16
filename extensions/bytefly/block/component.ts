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
 * The call and the result are separate sibling components in the row, with no
 * spacer between them, so a rail drawn by each reads as one continuous rail.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { paint } from "../../../lib/tui/tokens.ts";
import { BLOCK_CONFIG, type BlockStatus } from "./config.ts";

/** An image-protocol line must pass through unprefixed, or the sequence corrupts. */
const IMAGE_LINE = /^\u001b(?:P|_G|\]1337;)/;

/** The status a block draws with: running, failed, or finished cleanly. */
export function blockStatus(state: { isPartial: boolean; isError: boolean }): BlockStatus {
	return state.isPartial ? "info" : state.isError ? "bad" : "ok";
}

/**
 * Render `inner` at the reduced width and prefix every line with the indent and
 * the rail. A line that carries an image protocol sequence is passed through
 * untouched, and trailing lines with no visible content are dropped so an empty
 * result adds no bare rail.
 */
export function toolBlockLines(
	inner: Component | undefined,
	status: BlockStatus,
	theme: Theme,
	width: number,
	outputPad: number,
): string[] {
	const w = Math.max(1, width);
	if (!inner) return [];
	const pad = Math.max(0, Math.min(Math.floor(outputPad), w - 2));
	const prefix = `${" ".repeat(pad)}${paint(theme, BLOCK_CONFIG.roles[status], BLOCK_CONFIG.rail)} `;
	const innerWidth = Math.max(1, w - visibleWidth(prefix));

	const lines: string[] = [];
	const blank: boolean[] = [];
	for (const line of inner.render(innerWidth)) {
		if (IMAGE_LINE.test(line)) {
			lines.push(line);
			blank.push(false);
			continue;
		}
		lines.push(truncateToWidth(`${prefix}${line}`, w, ""));
		blank.push(visibleWidth(line) === 0);
	}
	while (blank.length > 0 && blank[blank.length - 1]) {
		lines.pop();
		blank.pop();
	}
	return lines;
}

/** The rail frame Pi mounts in place of its background box for a tool row. */
export class ToolBlock implements Component {
	constructor(
		private readonly inner: Component | undefined,
		private readonly status: BlockStatus,
		private readonly theme: Theme,
		private readonly outputPad: number,
	) {}

	invalidate(): void {
		this.inner?.invalidate();
	}

	render(width: number): string[] {
		return toolBlockLines(this.inner, this.status, this.theme, Math.max(1, width), this.outputPad);
	}
}
