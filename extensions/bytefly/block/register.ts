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
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { blockStatus, ToolBlock } from "./component.ts";
import { callFallback, resultFallback } from "./fallback.ts";

/** Register the resolver that frames every tool block with the bytefly rail. */
export function registerToolBlocks(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		if (base?.renderShell === "self") return base;
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const inner =
					base?.renderCall?.(args, theme, context) ??
					new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad);
			},
			renderResult: (result, options, theme, context) => {
				const inner =
					base?.renderResult?.(result, options, theme, context) ??
					new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				return new ToolBlock(inner, blockStatus(context), theme, context.outputPad);
			},
		};
	});
}
