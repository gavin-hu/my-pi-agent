/**
 * Registers bytefly's tool-block resolver.
 *
 * The resolver runs for every tool, built-ins included. It switches the row to
 * `renderShell: "self"` — dropping Pi's filled status background — and frames
 * the tool's own `renderCall` / `renderResult`, so the content is unchanged and
 * only the framing is bytefly's. The call leads with its own first line as an
 * un-railed headline; the body hangs from the rail. A tool with no renderer gets
 * the same treatment around a generic fallback.
 *
 * The frame is added even for a tool that sets `renderShell: "self"` (`edit`):
 * that only tells Pi not to draw its filled box, and the shipped themes leave
 * the tool fills to the terminal, so its diff would otherwise be the one body
 * with no rail. The rail is bytefly's, not Pi's box, so nothing nests.
 *
 * Pi hands a renderer the component it returned last time as
 * `context.lastComponent`, and every built-in renderer reuses it in place — it
 * assumes that component is its own `Text` and calls `setText` on it. We return
 * a `ToolBlock`, so passing it back would break the base renderer (it throws
 * `text.setText is not a function`, and the row falls back to Pi's generic call
 * line). The resolver therefore keeps each base renderer's own component in the
 * row's shared `state` and hands *that* back, so the base updates in place while
 * we wrap the result in a fresh frame.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { blockStatus, ToolBlock } from "./component.ts";
import { callFallback, resultFallback } from "./fallback.ts";

/** Per-row memory of the base renderer's own components, kept off Pi's state. */
interface BlockMemory {
	byteflyBaseCall?: Component;
	byteflyBaseResult?: Component;
}

/** Register the resolver that frames every tool block with the bytefly rail. */
export function registerToolBlocks(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderCall?.(args, theme, { ...context, lastComponent: memory.byteflyBaseCall }) ??
					new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				memory.byteflyBaseCall = inner;
				// The call's own first line is the block's headline; the frame trims the
				// blank edges a self-shell `Box` (`edit`) pads itself with.
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad, {
					headline: true,
					trimLeading: true,
					toolName,
				});
			},
			renderResult: (result, options, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderResult?.(result, options, theme, { ...context, lastComponent: memory.byteflyBaseResult }) ??
					new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				memory.byteflyBaseResult = inner;
				// The headline already added the blank line, so drop the result's own
				// leading spacer rather than doubling it.
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad, { trimLeading: true });
			},
		};
	});
}
