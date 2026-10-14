/**
 * The footer surface: the two-line status bar, its `/bytefly` toggle, and the
 * session lifecycle that installs and restores it.
 *
 * The footer is installed only in interactive (`tui`) sessions, and the price
 * configuration is read once per install, so toggling the footer — or starting
 * a new session — is how an edited `bytefly.json` is picked up. Nothing watches
 * the file.
 */

import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { loadByteflyConfig } from "./price/config.ts";
import { createFooter } from "./render/footer.ts";

/** Register `/bytefly [status]` and the install/restore lifecycle. */
export function registerFooter(pi: ExtensionAPI): void {
	let enabled = true;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		const config = loadByteflyConfig(ctx.cwd);
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

	pi.registerCommand("bytefly", {
		description: "Toggle the TUI bytefly footer: /bytefly [status]",
		getArgumentCompletions: (prefix: string) => {
			const action = prefix.trim();
			const options = ["status"].filter((option) => option.startsWith(action));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const sub = args.trim().toLowerCase();

			if (sub === "status") {
				ctx.ui.notify(`bytefly: ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (sub === "") {
				enabled = !enabled;
				install(ctx);
				ctx.ui.notify(`bytefly ${enabled ? "on" : "off"}`, "info");
				return;
			}
			ctx.ui.notify("usage: /bytefly [status]", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
