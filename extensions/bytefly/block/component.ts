/**
 * The tool-block frame: a tool's own call line as the headline, then its body
 * indented under it.
 *
 * The resolver sets `renderShell: "self"`, so Pi draws no background box and no
 * padding; this frame supplies the indent and the width math. The inner
 * component is the tool's existing renderer (or a generic fallback), so syntax
 * highlighting, diffs, previews, and truncation notices are preserved — only the
 * frame changes.
 *
 * The call block leads with its first non-blank line — the tool's own call line,
 * which every built-in and package renderer already opens with the tool name —
 * and the body follows at `BODY_INDENT` columns, with no separator line, so the
 * block is compact. There is no rail and no status colour: a block reads as one
 * left edge, and a failure is whatever the tool's own output shows.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import { BODY_INDENT, indentedLines } from "../../../lib/tui/indent.ts";
import { paintPrefix } from "../../../lib/tui/tokens.ts";

/** How one tool-block frame is drawn. */
export interface ToolBlockOptions {
	/**
	 * Lead with the component's first non-blank line as the block's headline. Set
	 * on the call, never on the result.
	 */
	headline?: boolean;
	/**
	 * Drop the component's own leading blank lines, so a self-shell `Box` (`edit`)
	 * or a result's spacer never opens the block with a gap.
	 */
	trimLeading?: boolean;
	/** The tool name, so a shell prompt in the headline becomes the tool name. */
	toolName?: string;
	/**
	 * The active theme. A shell call's command is repainted in the `label` role,
	 * so only the tool name spends the accent; without it the line is left as Pi
	 * drew it.
	 */
	theme?: Theme;
}

/**
 * Pi draws a shell call as `$ <command>` (or `> <command>` in PowerShell) rather
 * than `bash <command>`. The tool name is the block's headline, so rewrite that
 * leading prompt in place. The name keeps Pi's `toolTitle` styling (the accent
 * in the shipped themes); the command is reopened in `label` and the bold run
 * ended, so the name is the block's only accent.
 */
const SHELL_PROMPT = /^\s*[$>] /;
/** The prompt and the space after it, so a themed rewrite can replace both. */
const SHELL_PROMPT_SPAN = /[$>] /;

/** Replace a shell call's leading prompt with the tool name. */
export function headlineWithToolName(line: string, toolName: string, theme?: Theme): string {
	if (!SHELL_PROMPT.test(stripTerminalSequences(line))) return line;
	const name = sanitizeLine(toolName);
	if (!theme) return line.replace(/[$>]/, name);
	// `\u001b[22m` ends the name's bold run; the role's opening colours what
	// follows, which Pi's own trailing reset then closes.
	return line.replace(SHELL_PROMPT_SPAN, `${name} \u001b[22m${paintPrefix(theme, "label")}`);
}

/**
 * Recolour a shell call's prompt on its whole (unwrapped) string.
 *
 * Pi renders `$ <command>` as one `toolTitle` run, which `Text` then wraps; a
 * rewrite applied to the first *rendered* line would leave every wrapped
 * fragment of the command in the accent. Applying it before the wrap keeps the
 * name's accent and the command's `label` on every fragment, because the wrap
 * re-emits whichever run it split. Returns `text` unchanged when its first line
 * is not a shell prompt.
 */
export function recolorShellCall(text: string, toolName: string, theme: Theme): string {
	const end = text.indexOf("\n");
	const head = end === -1 ? text : text.slice(0, end);
	if (!SHELL_PROMPT.test(stripTerminalSequences(head))) return text;
	const rewritten = headlineWithToolName(head, toolName, theme);
	return end === -1 ? rewritten : rewritten + text.slice(end);
}

/**
 * Indent `inner` under the block's headline: the body at `outputPad + BODY_INDENT`,
 * the headline (when asked for) at `outputPad`. `width` clips the headline again
 * after its prompt is rewritten, so a longer tool name cannot overflow.
 */
export function toolBlockLines(
	inner: Component | undefined,
	width: number,
	outputPad: number,
	options: ToolBlockOptions = {},
): string[] {
	const w = Math.max(1, width);
	const lines = indentedLines(inner, w, {
		indent: (outputPad ?? 0) + BODY_INDENT,
		headline: options.headline,
		trimLeading: options.trimLeading,
	});
	if (options.headline && lines.length > 0) {
		// The base renders at the reduced (indented) width, so drop the padding it
		// added before the prompt rewrite can push the headline over the clip.
		const headline = (lines[0] ?? "").trimEnd();
		lines[0] = truncateToWidth(
			options.toolName ? headlineWithToolName(headline, options.toolName, options.theme) : headline,
			w,
			"…",
		);
	}
	return lines;
}

/** The frame Pi mounts in place of its background box for a tool row. */
export class ToolBlock implements Component {
	constructor(
		private readonly inner: Component | undefined,
		private readonly outputPad: number,
		private readonly options: ToolBlockOptions = {},
	) {}

	invalidate(): void {
		this.inner?.invalidate();
	}

	render(width: number): string[] {
		return toolBlockLines(this.inner, Math.max(1, width), this.outputPad, this.options);
	}
}
