/**
 * The header surface: installs bytefly's custom header on interactive
 * sessions and restores Pi's built-in header on shutdown.
 *
 * The surface is toggleable: `/bytefly header` (and the `/bytefly` master
 * switch) calls `setEnabled` then `apply`, and a new session re-applies the
 * current state. It is installed only in interactive (`tui`) sessions; every
 * other mode leaves Pi's built-in header in place, which does not exist there.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAppleTerminalSession } from "@earendil-works/pi-tui";
import { createHeader, type HeaderView } from "./component.ts";
import { HEADER_CONFIG } from "./config.ts";

/** The header surface, as `/bytefly` drives it. */
export interface HeaderSurface {
	/** Install the header, or restore Pi's built-in one, from the current state. */
	apply(ctx: ExtensionContext): void;
	/** Whether the header is currently on. */
	isEnabled(): boolean;
	/** Set the enabled flag without installing. */
	setEnabled(enabled: boolean): void;
}

/** Register the install/restore lifecycle for the custom header. */
export function registerHeader(pi: ExtensionAPI): HeaderSurface {
	// Half blocks misalign in Apple Terminal, so the mark falls back to a wordmark
	// there, mirroring Pi's own built-in header.
	const halfBlocks = !isAppleTerminalSession();
	const view = (): HeaderView => ({ showVersion: HEADER_CONFIG.showVersion, halfBlocks });
	let enabled = true;

	const apply = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(enabled ? createHeader(() => ctx.ui.theme, view) : undefined);
	};

	pi.on("session_start", (_event, ctx) => apply(ctx));
	pi.on("session_tree", (_event, ctx) => apply(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
	});

	return {
		apply,
		isEnabled: () => enabled,
		setEnabled: (value: boolean) => {
			enabled = value;
		},
	};
}
