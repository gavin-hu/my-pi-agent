/**
 * status-bar — a two-line colorful footer for Pi.
 *
 * Line 1 is identity: the working directory on the left, the git branch and
 * worktree status on the right. Line 2 is resources: the context gauge and
 * usage meters on the left with the plan/alert statuses trailing, and the model
 * and thinking level on the right. The bar shrinks and drops segments by
 * priority as the terminal narrows, and is only installed in interactive (`tui`)
 * sessions.
 *
 * Load with:  pi --extension ./extensions/status-bar
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createFooter } from "./footer.ts";
import { createSnapshotReader } from "./snapshot.ts";

export default function statusBar(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("status-bar")) return;
	let enabled = true;
	const read = createSnapshotReader();

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		if (!enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}
		ctx.ui.setFooter((tui, _theme, footerData) =>
			createFooter(
				tui,
				footerData,
				() => read(ctx, footerData),
				() => ctx.ui.theme,
				homedir(),
			),
		);
	};

	pi.registerCommand("status-bar", {
		description: "Toggle the colorful status bar",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			enabled = !enabled;
			if (enabled) {
				install(ctx);
				ctx.ui.notify("Status bar enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Status bar disabled", "info");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});
}
