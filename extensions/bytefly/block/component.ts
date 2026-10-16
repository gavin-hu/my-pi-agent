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
 * block is compact. A result body may carry a `rail`: a pre-painted glyph in the
 * first indent column, occupying the two columns the plain indent uses. The call
 * never carries one.
 *
 * A tool that mutates a file (`edit`, `write`) may carry a `fill`: every body
 * line is padded to the frame's width and wrapped, so the result sits on one
 * edge-to-edge band and the state colour reads as a rectangle rather than a
 * ragged stripe. The headline is the call, so it stays unfilled. The wrapper is
 * injected, so the frame stays theme-agnostic; a tool whose own renderer paints a
 * background is handed a no-op `bg` and leaves the fill to the frame.
 *
 * The tool name is the block's only accent. The shipped themes point
 * `toolTitle` at the accent, so a primary subject — a path, URL, query, pattern
 * — would otherwise spend the same colour; `recolorCallHeadline` demotes it to
 * the body role on the call's first line.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeLine } from "../../../lib/format.ts";
import { BODY_INDENT, IMAGE_LINE, indentedLines } from "../../../lib/tui/indent.ts";
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
	 * A pre-painted rail glyph for the body's first indent column, from
	 * `../chrome.ts`. Set on the result frame only; the call stays plain-indented.
	 */
	rail?: string;
	/**
	 * The active theme. A shell call's command and a call's primary subject are
	 * repainted in the `label` role, so only the tool name spends the accent;
	 * without it the line is left as Pi drew it.
	 */
	theme?: Theme;
	/**
	 * Fill each body line to the frame's full width and wrap it, so the result
	 * sits on one edge-to-edge background band. Set for the tools that paint a
	 * status fill (`edit`, `write`); the caller supplies the wrapper. The headline
	 * is the call, so it is never filled, and an image-protocol line passes through
	 * untouched.
	 */
	fill?: (line: string) => string;
}

/** Pad a line to `width` visible columns, so a fill wrapper covers the frame. */
function padToWidth(line: string, width: number): string {
	const gap = width - visibleWidth(line);
	return gap > 0 ? `${line}${" ".repeat(gap)}` : line;
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
 * Demote a call headline's primary subject from the accent to the body colour,
 * so the tool name is the block's only accent.
 *
 * The name and the subject share the accent sequence in the shipped themes, so
 * the name is told apart by position: the first accent opening at or after the
 * tool name stays, and every later one on the first line is the subject. Only
 * line one is touched — a multi-line call's continuation lines keep their own
 * roles.
 */
export function recolorCallHeadline(text: string, toolName: string, theme: Theme): string {
	const accent = paintPrefix(theme, "accent");
	const label = paintPrefix(theme, "label");
	if (!accent || accent === label) return text;
	const end = text.indexOf("\n");
	const head = end === -1 ? text : text.slice(0, end);
	if (!head.includes(accent)) return text;

	// Everything after the tool name is its subject; without a name to anchor on
	// (a renderer that does not open with it) demote the whole line.
	const name = sanitizeLine(toolName);
	const at = head.indexOf(name);
	const from = at === -1 ? 0 : at + name.length;

	let out = "";
	let i = 0;
	for (;;) {
		const hit = head.indexOf(accent, i);
		if (hit === -1) {
			out += head.slice(i);
			break;
		}
		out += head.slice(i, hit);
		out += hit >= from ? label : accent;
		i = hit + accent.length;
	}
	return end === -1 ? out : out + text.slice(end);
}

/** A renderer component that carries a mutable string: Pi's own `Text`. */
interface Rewritable {
	text: string;
	setText(text: string): void;
}

/**
 * Whether a component exposes the `Text` shape. Pi's shell renderers return a
 * `Text`, whose `text` field is private to the type but present at runtime.
 */
export function isRewritable(component: Component): component is Component & Rewritable {
	const candidate = component as Partial<Rewritable>;
	return typeof candidate.text === "string" && typeof candidate.setText === "function";
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
		rail: options.rail,
		headline: options.headline,
		trimLeading: options.trimLeading,
	});
	if (options.headline && lines.length > 0) {
		// The base renders at the reduced (indented) width, so drop the padding it
		// added before the prompt rewrite can push the headline over the clip.
		const headline = (lines[0] ?? "").trimEnd();
		const named = options.toolName ? headlineWithToolName(headline, options.toolName, options.theme) : headline;
		// A renderer that rebuilds its component after `renderCall` (`edit` moves its
		// diff onto the box) drops the rewrite the resolver applied there, so the
		// headline is demoted again here. It is a no-op for a call the resolver
		// already recoloured before the wrap.
		const recolored =
			options.toolName && options.theme ? recolorCallHeadline(named, options.toolName, options.theme) : named;
		lines[0] = truncateToWidth(recolored, w, "…");
	}
	if (!options.fill) return lines;
	const fill = options.fill;
	// The headline is the tool call; only the body it sits over carries the fill.
	const start = options.headline ? 1 : 0;
	return lines.map((line, index) => (index < start || IMAGE_LINE.test(line) ? line : fill(padToWidth(line, w))));
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
