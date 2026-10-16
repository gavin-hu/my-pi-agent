/**
 * Registers bytefly's tool-block resolver.
 *
 * The resolver runs for every tool, built-ins included. It switches the row to
 * `renderShell: "self"` — dropping Pi's filled status background — and frames
 * the tool's own `renderCall` / `renderResult`, so the content is unchanged and
 * only the framing is bytefly's. The call leads with its own first line as the
 * headline; the body is indented directly under it. A tool with no renderer gets
 * the same treatment around a generic fallback.
 *
 * The frame is added even for a tool that sets `renderShell: "self"` (`edit`):
 * that only tells Pi not to draw its filled box, and the shipped themes leave
 * the tool fills to the terminal, so its diff would otherwise sit at the wrong
 * indent. The indent is bytefly's, not Pi's box, so nothing nests.
 *
 * Pi hands a renderer the component it returned last time as
 * `context.lastComponent`, and every built-in renderer reuses it in place — it
 * assumes that component is its own `Text` and calls `setText` on it. We return
 * a `ToolBlock`, so passing it back would break the base renderer (it throws
 * `text.setText is not a function`, and the row falls back to Pi's generic call
 * line). The resolver therefore keeps each base renderer's own component in the
 * row's shared `state` and hands *that* back, so the base updates in place while
 * we wrap the result in a fresh frame.
 *
 * Because the frame takes over the row's `outputPad`, the base renderer is
 * handed `outputPad: 0`. Pi's `edit` is a natively self-shell renderer and pads
 * its own `Box` by `context.outputPad`; leaving the host value in place would
 * add the pad twice and set the whole edit block a column deeper than every
 * other block. The frame is the only place that applies the pad.
 *
 * Before framing, a shell call's `$ <command>` string is rewritten so the tool
 * name keeps the accent and the command reads as the body (`recolorShellCall`).
 * Doing it on the string rather than the wrapped lines keeps the whole command
 * in one role when a long command wraps.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { createPadStore, type PadSource } from "../pad.ts";
import { recolorShellCall, ToolBlock } from "./component.ts";
import { callFallback, resultFallback } from "./fallback.ts";

/** Per-row memory of the base renderer's own components, kept off Pi's state. */
interface BlockMemory {
	byteflyBaseCall?: Component;
	byteflyBaseResult?: Component;
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
function isRewritable(component: Component): component is Component & Rewritable {
	const candidate = component as Partial<Rewritable>;
	return typeof candidate.text === "string" && typeof candidate.setText === "function";
}

/** Register the resolver that frames every tool block with the bytefly indent. */
export function registerToolBlocks(pi: ExtensionAPI, pad: PadSource = createPadStore()): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderCall?.(args, theme, {
						...context,
						outputPad: 0,
						lastComponent: memory.byteflyBaseCall,
					}) ?? new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				memory.byteflyBaseCall = inner;
				// Split a shell call's roles before the frame wraps it: Pi renders
				// `$ <cmd>` as one `toolTitle` run, so a rewrite after wrapping would
				// only reach the first line and leave the wrapped command in the
				// accent. `recolorShellCall` is a no-op for a call that is not a shell
				// prompt.
				if (isRewritable(inner)) inner.setText(recolorShellCall(inner.text, toolName, theme));
				// The call's own first line is the block's headline; the frame drops the
				// blank edges a self-shell `Box` (`edit`) pads itself with.
				return new ToolBlock(inner, pad.resolve(context.outputPad), {
					headline: true,
					trimLeading: true,
					toolName,
					theme,
				});
			},
			renderResult: (result, options, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderResult?.(result, options, theme, {
						...context,
						outputPad: 0,
						lastComponent: memory.byteflyBaseResult,
					}) ?? new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				memory.byteflyBaseResult = inner;
				// A tool's own leading spacer would open the body with a gap, so drop it.
				return new ToolBlock(inner, pad.resolve(context.outputPad), { trimLeading: true });
			},
		};
	});
}
