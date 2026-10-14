/**
 * The header surface: installs bytefly's custom header on interactive
 * sessions and restores Pi's built-in header on shutdown.
 *
 * The header is installed only in interactive (`tui`) sessions; every other
 * mode leaves Pi's built-in header in place, which does not exist there.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHeader, type HeaderView } from "./component.ts";
import { HEADER_CONFIG } from "./config.ts";

/** Register the install/restore lifecycle for the custom header. */
export function registerHeader(pi: ExtensionAPI): void {
	const view = (): HeaderView => ({ mark: HEADER_CONFIG.mark, showVersion: HEADER_CONFIG.showVersion });

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(createHeader(() => ctx.ui.theme, view));
	};

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
	});
}
