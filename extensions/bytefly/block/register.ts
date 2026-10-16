/**
 * Registers bytefly's tool-block resolver.
 *
 * The resolver runs for every tool, built-ins included. It switches the row to
 * `renderShell: "self"` — dropping Pi's filled status background — and wraps
 * the tool's own `renderCall` / `renderResult` in the rail frame, so the
 * content is unchanged and only the framing is bytefly's. A tool with no
 * renderer gets a framed generic fallback instead of an unframed row.
 *
 * A tool that already renders its own shell (`renderShell: "self"`, currently
 * `edit`) is returned untouched: it draws its own frame, and wrapping it would
 * nest a second one.
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
		if (base?.renderShell === "self") return base;
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderCall?.(args, theme, { ...context, lastComponent: memory.byteflyBaseCall }) ??
					new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				memory.byteflyBaseCall = inner;
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad);
			},
			renderResult: (result, options, theme, context) => {
				const memory = context.state as BlockMemory;
				const inner =
					base?.renderResult?.(result, options, theme, { ...context, lastComponent: memory.byteflyBaseResult }) ??
					new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				memory.byteflyBaseResult = inner;
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad);
			},
		};
	});
}
