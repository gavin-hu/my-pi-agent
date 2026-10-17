/**
 * Registers bytefly's tool-block resolver.
 *
 * The resolver runs for every tool, built-ins included. It switches the row to
 * `renderShell: "self"` — dropping Pi's filled status background — and frames
 * the tool's own `renderCall` / `renderResult`, so the content is unchanged and
 * only the framing is bytefly's. The call leads with its own first line as the
 * headline; the body is indented directly under it. The body carries the
 * transcript rail, painted by status. The result frame rails every tool; the
 * call frame rails only the two file-mutating tools (`edit`, `write`), whose
 * call body *is* the result (a diff, a written file). A tool with no renderer
 * gets the same treatment around a generic fallback.
 *
 * The frame is added even for a tool that sets `renderShell: "self"` (`edit`):
 * that only tells Pi not to draw its filled box, so its diff would otherwise sit
 * at the wrong indent. The indent is bytefly's, not Pi's box, so nothing nests.
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
 * The two tools that mutate a file (`edit`, `write`) carry their result on the
 * call, so the call body is railed like a result. Pi's `edit` paints its own
 * `Box` from a tool background role, so the frame hands it a theme whose `bg` is
 * inert; otherwise the base would paint a band the rest of the transcript does
 * not have. (`write` is a plain `Text` and paints nothing; the facade is a no-op
 * there but shared.)
 *
 * Before framing, a shell call's `$ <command>` string is rewritten so the tool
 * name keeps the accent and the command reads as the body (`recolorShellCall`),
 * and a call's primary subject is demoted to the body colour
 * (`recolorCallHeadline`), so the tool name is the block's only accent. Doing
 * both on the string rather than the wrapped lines keeps a long command or
 * subject in one role when it wraps; the frame repeats the subject rewrite for a
 * component that is rebuilt after this point (`edit`).
 */

import type { ExtensionAPI, Theme, ThemeBg } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { createRailSource, railGlyph, type RailSource } from "../chrome.ts";
import { createPadStore, type PadSource } from "../pad.ts";
import { isRewritable, recolorCallHeadline, recolorShellCall, ToolBlock } from "./component.ts";
import { BLOCK_CONFIG, type BlockStatus } from "./config.ts";
import { callFallback, resultFallback } from "./fallback.ts";

/** Per-row memory of the base renderer's own components, kept off Pi's state. */
interface BlockMemory {
	byteflyBaseCall?: Component;
	byteflyBaseResult?: Component;
}

/** The tools whose call body carries the result: the two that mutate a file. */
const RESULT_ON_CALL = new Set(["edit", "write"]);

/** The painted rail glyph for a row's state: running spends the accent, a failure red. */
function statusRail(theme: Theme, context: { isPartial: boolean; isError: boolean }, glyph: string): string {
	const status: BlockStatus = context.isPartial ? "info" : context.isError ? "bad" : "ok";
	return railGlyph(theme, BLOCK_CONFIG.roles[status], glyph);
}

/**
 * A theme whose `bg` is inert. Pi's `edit` paints its own `Box` from a tool
 * background role; the transcript has no bands, so the base must not paint one.
 * Every other method is inherited unchanged.
 */
function withoutBackground(theme: Theme): Theme {
	const suppressed = Object.create(theme) as Theme;
	suppressed.bg = (_color: ThemeBg, text: string) => text;
	return suppressed;
}

/** Register the resolver that frames every tool block with the bytefly indent. */
export function registerToolBlocks(
	pi: ExtensionAPI,
	pad: PadSource = createPadStore(),
	rail: RailSource = createRailSource(),
): void {
	pi.registerToolRenderer((toolName, next) => {
		const base = next();
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const memory = context.state as BlockMemory;
				const resultOnCall = RESULT_ON_CALL.has(toolName);
				let inner: Component;
				try {
					inner =
						base?.renderCall?.(args, resultOnCall ? withoutBackground(theme) : theme, {
							...context,
							outputPad: 0,
							lastComponent: memory.byteflyBaseCall,
						}) ?? new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				} catch {
					// A base renderer can throw on a partial (still-streaming) argument.
					// Frame our own fallback at the frame's pad rather than let the throw
					// reach Pi, which would swap in its generic call line a column to the
					// left and make the row jump.
					inner = new Text(callFallback(toolName, args, theme, context.expanded), 0, 0);
				}
				memory.byteflyBaseCall = inner;
				// Split a shell call's roles before the frame wraps it: Pi renders
				// `$ <cmd>` as one `toolTitle` run, so a rewrite after wrapping would
				// only reach the first line and leave the wrapped command in the
				// accent. `recolorShellCall` is a no-op for a call that is not a shell
				// prompt. Then demote the subject (a path, URL, query, pattern) to the
				// body colour, so the tool name is the call's only accent. Both run
				// before the wrap for the same reason; the frame repeats the subject
				// rewrite for a component that is rebuilt after this point (`edit`).
				if (isRewritable(inner)) {
					inner.setText(recolorCallHeadline(recolorShellCall(inner.text, toolName, theme), toolName, theme));
				}
				// The call's own first line is the block's headline; the frame drops the
				// blank edges a self-shell `Box` (`edit`) pads itself with. A tool whose
				// call body is its result (`edit`, `write`) rails that body.
				return new ToolBlock(inner, pad.resolve(context.outputPad), {
					headline: true,
					trimLeading: true,
					toolName,
					theme,
					rail: resultOnCall ? statusRail(theme, context, rail.resolve()) : undefined,
				});
			},
			renderResult: (result, options, theme, context) => {
				const memory = context.state as BlockMemory;
				const resultOnCall = RESULT_ON_CALL.has(toolName);
				let inner: Component;
				try {
					inner =
						base?.renderResult?.(result, options, resultOnCall ? withoutBackground(theme) : theme, {
							...context,
							outputPad: 0,
							lastComponent: memory.byteflyBaseResult,
						}) ?? new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				} catch {
					inner = new Text(resultFallback(result.content, theme, options.expanded), 0, 0);
				}
				memory.byteflyBaseResult = inner;
				// A tool's own leading spacer would open the body with a gap, so drop it.
				return new ToolBlock(inner, pad.resolve(context.outputPad), {
					trimLeading: true,
					rail: statusRail(theme, context, rail.resolve()),
				});
			},
		};
	});
}
