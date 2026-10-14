/**
 * chrome — a two-line, width-adaptive TUI footer.
 *
 * The footer is priced from DeepSeek's published rates by default and from
 * `chrome.json` otherwise. Pi's own header is left untouched.
 *
 * The footer is installed only in interactive (`tui`) sessions and toggled with
 * `/chrome [status]`.
 *
 * Load with:  pi --extension ./extensions/chrome
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { loadChromeConfig } from "./config.ts";
import { createFooter } from "./render/footer.ts";

export default function chrome(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("chrome")) return;
	let enabled = true;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// The config is read per install, so toggling the footer — or a new
		// session — is how an edited file is picked up: nothing watches it.
		const config = loadChromeConfig(ctx.cwd);
		const read = createSnapshotReader(config);

		if (enabled) {
			ctx.ui.setFooter((tui, _theme, footerData) =>
				createFooter(
					tui,
					footerData,
					() => read(ctx, footerData),
					() => ctx.ui.theme,
					homedir(),
				),
			);
		} else {
			ctx.ui.setFooter(undefined);
		}
	};

	pi.registerCommand("chrome", {
		description: "Toggle the TUI chrome footer: /chrome [status]",
		getArgumentCompletions: (prefix: string) => {
			const action = prefix.trim();
			const options = ["status"].filter((option) => option.startsWith(action));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const sub = args.trim().toLowerCase();

			if (sub === "status") {
				ctx.ui.notify(`chrome: ${enabled ? "footer" : "disabled"}`, "info");
				return;
			}
			if (sub === "") {
				enabled = !enabled;
				install(ctx);
				ctx.ui.notify(`chrome ${enabled ? "on" : "off"}`, "info");
				return;
			}
			ctx.ui.notify("usage: /chrome [status]", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
