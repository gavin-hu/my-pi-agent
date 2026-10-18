/**
 * The header surface: installs bytefly's custom header on interactive sessions
 * when Pi's `quietStartup` is `true` — the toggle exposed as "Bytefly startup
 * TUI" — and restores Pi's built-in header on shutdown.
 *
 * `quietStartup: true` hides Pi's built-in startup header, so bytefly's header
 * is what the terminal shows. `false`, `"header"`, and an unset value leave
 * Pi's built-in header in place, which is the bytefly-startup-TUI-off state.
 * `pi config` remains the way to turn all of bytefly's chrome off. The header
 * is installed only in interactive (`tui`) sessions; every other mode leaves
 * Pi's built-in header in place, which does not exist there.
 *
 * The update check resolves after this install, so the header reads the newest
 * known version through `UpdateSource` and `refresh()` re-applies the last
 * context's header once one arrives. That is the only reason the header is ever
 * installed twice.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAppleTerminalSession } from "@earendil-works/pi-tui";
import { DEFAULT_HOST_PAD } from "../pad.ts";
import { createUpdateState, type UpdateSource } from "../update/state.ts";
import { createHeader, type HeaderView } from "./component.ts";
import { HEADER_CONFIG } from "./config.ts";

/** The installed header, and the way to re-install it after a change. */
export interface HeaderHandle {
	/** Re-apply the last session's header, picking up the current update marker. */
	refresh(): void;
}

/**
 * Register the install/restore lifecycle for the custom header.
 *
 * `updates` is the store the update check writes, so the marker appears when a
 * newer version is known. A test that does not exercise the marker may omit it.
 */
export function registerHeader(pi: ExtensionAPI, updates: UpdateSource = createUpdateState()): HeaderHandle {
	// Half blocks misalign in Apple Terminal, so the mark falls back to a wordmark
	// there, mirroring Pi's own built-in header.
	const halfBlocks = !isAppleTerminalSession();
	let last: ExtensionContext | undefined;

	const apply = (ctx: ExtensionContext): void => {
		last = ctx;
		if (ctx.mode !== "tui") return;
		// Bytefly's startup TUI is on only when Pi's `quietStartup` is true, which
		// hides Pi's built-in startup header. Every other value (`false`,
		// `"header"`, unset) leaves Pi's built-in header in charge.
		if (pi.getSettings?.().quietStartup !== true) {
			ctx.ui.setHeader(undefined);
			return;
		}
		// The nameplate sits on the transcript margin, which is Pi's output pad — the
		// value the tool frame and the notice inset by. An older host without
		// `getSettings` keeps the default margin.
		const pad = pi.getSettings?.().outputPad ?? DEFAULT_HOST_PAD;
		const view = (): HeaderView => ({
			showVersion: HEADER_CONFIG.showVersion,
			halfBlocks,
			pad,
			latest: updates.latest(),
		});
		ctx.ui.setHeader(createHeader(() => ctx.ui.theme, view));
	};

	pi.on("session_start", (_event, ctx) => apply(ctx));
	pi.on("session_tree", (_event, ctx) => apply(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		last = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
	});

	return {
		refresh() {
			if (last) apply(last);
		},
	};
}
