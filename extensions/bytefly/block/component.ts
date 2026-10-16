/**
 * The tool-block frame: a tool's own call line as an un-railed headline, then
 * its body hanging from the shared status rail.
 *
 * The resolver sets `renderShell: "self"`, so Pi draws no background box and no
 * padding; this frame supplies the indent, the headline, the rail, and the width
 * math. The inner component is the tool's existing renderer (or a generic
 * fallback), so syntax highlighting, diffs, previews, and truncation notices are
 * preserved — only the framing changes.
 *
 * The call block leads with its first non-blank line un-railed — the tool's own
 * call line, which every built-in and package renderer already opens with the
 * tool name — followed by one plain blank line. The call and the result are
 * separate sibling components in the row, both railed, so the body reads as one
 * continuous rail (`lib/tui/rail.ts`, the same rail a notice and a subagent quote
 * draw) below the headline.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import { railLines } from "../../../lib/tui/rail.ts";
import { BLOCK_CONFIG, type BlockStatus } from "./config.ts";

/** How one tool-block frame is drawn. */
export interface ToolBlockOptions {
	/**
	 * Lead with the component's first non-blank line, un-railed, as the block's
	 * headline. Set on the call, never on the result.
	 */
	headline?: boolean;
	/**
	 * Drop the component's own leading blank lines. Set for a `renderShell:
	 * "self"` call (`edit`), whose `Box` pads itself top and bottom, and for the
	 * result, so a tool's own spacer never doubles the headline's blank line.
	 */
	trimLeading?: boolean;
	/** The tool name, so a shell prompt in the headline becomes the tool name. */
	toolName?: string;
}

/** The status a block draws with: running, failed, or finished cleanly. */
export function blockStatus(state: { isPartial: boolean; isError: boolean }): BlockStatus {
	return state.isPartial ? "info" : state.isError ? "bad" : "ok";
}

/**
 * Pi draws a shell call as `$ <command>` (or `> <command>` in PowerShell) rather
 * than `bash <command>`. The tool name is the block's headline, so rewrite that
 * leading prompt in place; the character keeps the styling Pi already gave it.
 */
const SHELL_PROMPT = /^\s*[$>] /;

/** Replace a shell call's leading prompt glyph with the tool name. */
export function headlineWithToolName(line: string, toolName: string): string {
	if (!SHELL_PROMPT.test(stripTerminalSequences(line))) return line;
	return line.replace(/[$>]/, sanitizeLine(toolName));
}

/**
 * Render `inner` behind the shared rail at the reduced width, painted by status.
 * `outputPad` indents the rail, the rail's own rules — image passthrough and the
 * blank trims — come from `lib/tui/rail.ts`, and a `headline` leads the block
 * un-railed. `width` clips the headline again after its prompt is rewritten, so
 * the longer tool name cannot overflow.
 */
export function toolBlockLines(
	inner: Component | undefined,
	status: BlockStatus,
	theme: Theme,
	width: number,
	outputPad: number,
	options: ToolBlockOptions = {},
): string[] {
	const w = Math.max(1, width);
	const lines = railLines(inner, BLOCK_CONFIG.roles[status], theme, w, {
		indent: outputPad,
		headline: options.headline,
		trimLeading: options.trimLeading,
	});
	if (options.headline && lines.length > 0) {
		// The base renders at the reduced (railed) width, so drop the padding it
		// added before the prompt rewrite can push the headline over the clip.
		const headline = (lines[0] ?? "").trimEnd();
		lines[0] = truncateToWidth(options.toolName ? headlineWithToolName(headline, options.toolName) : headline, w, "…");
	}
	return lines;
}

/** The frame Pi mounts in place of its background box for a tool row. */
export class ToolBlock implements Component {
	constructor(
		private readonly inner: Component | undefined,
		private readonly status: BlockStatus,
		private readonly theme: Theme,
		private readonly outputPad: number,
		private readonly options: ToolBlockOptions = {},
	) {}

	invalidate(): void {
		this.inner?.invalidate();
	}

	render(width: number): string[] {
		return toolBlockLines(this.inner, this.status, this.theme, Math.max(1, width), this.outputPad, this.options);
	}
}
