/**
 * The footer surface: the two-line status bar, the `/bytefly` surface toggle,
 * and the session lifecycle that installs and restores the footer.
 *
 * The footer is installed only in interactive (`tui`) sessions, and the price
 * configuration is read once per install, so toggling the footer — or starting
 * a new session — is how an edited `bytefly.json` is picked up. Nothing watches
 * the file.
 *
 * `/bytefly` also drives the header surface, injected by the composition root
 * so this folder never imports `header/`.
 */

import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { loadByteflyConfig } from "./price/config.ts";
import { createFooter } from "./render/footer.ts";

/** A bytefly surface the `/bytefly` command can enable or disable. */
export interface ChromeSurface {
	/** Install the surface, or restore Pi's built-in one, from the current state. */
	apply(ctx: ExtensionContext): void;
	/** Whether the surface is currently on. */
	isEnabled(): boolean;
	/** Set the enabled flag without installing. */
	setEnabled(enabled: boolean): void;
}

/** Host seams for the footer surface. */
export interface FooterDeps {
	/** The header surface, toggled by `/bytefly header` and the master switch. */
	header?: ChromeSurface;
}

/** Register `/bytefly [header|footer|status]` and the install/restore lifecycle. */
export function registerFooter(pi: ExtensionAPI, deps: FooterDeps = {}): void {
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

	const header = deps.header;
	const headerState = (): string => (header?.isEnabled() ? "on" : "off");

	pi.registerCommand("bytefly", {
		description: "Toggle the TUI bytefly chrome: /bytefly [header|footer|status]",
		getArgumentCompletions: (prefix: string) => {
			const action = prefix.trim();
			const options = ["footer", "header", "status"].filter((option) => option.startsWith(action));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const sub = args.trim().toLowerCase();

			if (sub === "status") {
				ctx.ui.notify(`bytefly: header ${headerState()}, footer ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (sub === "header") {
				if (!header) {
					ctx.ui.notify("bytefly: header surface is not available", "warning");
					return;
				}
				header.setEnabled(!header.isEnabled());
				header.apply(ctx);
				ctx.ui.notify(`bytefly header ${headerState()}`, "info");
				return;
			}
			if (sub === "footer") {
				enabled = !enabled;
				install(ctx);
				ctx.ui.notify(`bytefly footer ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (sub === "") {
				// The master switch brings both surfaces to one state.
				const next = !(enabled && (header?.isEnabled() ?? true));
				enabled = next;
				install(ctx);
				if (header) {
					header.setEnabled(next);
					header.apply(ctx);
				}
				ctx.ui.notify(`bytefly ${next ? "on" : "off"}`, "info");
				return;
			}
			ctx.ui.notify("usage: /bytefly [header|footer|status]", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
