/**
 * The header surface: installs bytefly's custom header on interactive sessions
 * and restores Pi's built-in header on shutdown.
 *
 * The surface is always on; `pi config` is the way to turn bytefly's chrome off.
 * It is installed only in interactive (`tui`) sessions; every other mode leaves
 * Pi's built-in header in place, which does not exist there.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAppleTerminalSession } from "@earendil-works/pi-tui";
import { DEFAULT_HOST_PAD } from "../pad.ts";
import { createHeader, type HeaderView } from "./component.ts";
import { HEADER_CONFIG } from "./config.ts";

/** Register the install/restore lifecycle for the custom header. */
export function registerHeader(pi: ExtensionAPI): void {
	// Half blocks misalign in Apple Terminal, so the mark falls back to a wordmark
	// there, mirroring Pi's own built-in header.
	const halfBlocks = !isAppleTerminalSession();

	const apply = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// The nameplate sits on the transcript margin, which is Pi's output pad — the
		// value the tool frame and the notice inset by. An older host without
		// `getSettings` keeps the default margin.
		const pad = pi.getSettings?.().outputPad ?? DEFAULT_HOST_PAD;
		const view = (): HeaderView => ({ showVersion: HEADER_CONFIG.showVersion, halfBlocks, pad });
		ctx.ui.setHeader(createHeader(() => ctx.ui.theme, view));
	};

	pi.on("session_start", (_event, ctx) => apply(ctx));
	pi.on("session_tree", (_event, ctx) => apply(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
	});
}
