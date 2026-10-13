/**
 * chrome — a themed TUI header and editor, plus a two-line footer.
 *
 * The header reproduces Pi's built-in structure (brand mark, version, key
 * hints) and recolors it from the active theme; it adds no data. The editor is
 * Pi's `CustomEditor` with a themed badge in its top border. The footer is the
 * two-line, width-adaptive bar formerly shipped as `status-bar`, priced from
 * DeepSeek's published rates by default and from `chrome.json` otherwise.
 *
 * Every surface is installed only in interactive (`tui`) sessions, and each is
 * independently toggleable with `/chrome [header|editor|footer|status]`.
 *
 * Load with:  pi --extension ./extensions/chrome
 */

import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isExtensionEnabled } from "../../lib/env.ts";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { loadChromeConfig } from "./config.ts";
import { createFooter } from "./render/footer.ts";
import { createEditor, createHeader, type HeaderView } from "./tui.ts";

type Surface = "header" | "editor" | "footer";
const SURFACES: readonly Surface[] = ["header", "editor", "footer"];

export default function chrome(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("chrome")) return;
	const active: Record<Surface, boolean> = { header: true, editor: true, footer: true };
	let enabled = true;
	// Captured from the editor factory, which the host calls once when set. The
	// header reads it live to resolve its key hints.
	let keybindings: KeybindingsManager | undefined;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// The config is read per install, so toggling a surface — or a new
		// session — is how an edited file is picked up: nothing watches it.
		const config = loadChromeConfig(ctx.cwd);
		const read = createSnapshotReader(config);
		const view = (): HeaderView => ({
			mark: config.header.mark,
			showVersion: config.header.showVersion,
			showHints: config.header.showHints,
		});

		// Editor first: its factory captures the `KeybindingsManager` the header
		// needs, and the host invokes the factory when it is set.
		if (enabled && active.editor) {
			ctx.ui.setEditorComponent(
				createEditor(
					() => ctx.ui.theme,
					() => enabled && active.editor,
					() => ctx.thinkingLevel,
					(manager) => {
						keybindings = manager;
					},
				),
			);
		} else {
			ctx.ui.setEditorComponent(undefined);
		}

		if (enabled && active.header) {
			ctx.ui.setHeader(
				createHeader(
					() => ctx.ui.theme,
					view,
					() => keybindings,
				),
			);
		} else {
			ctx.ui.setHeader(undefined);
		}

		if (enabled && active.footer) {
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
		description: "Toggle TUI chrome: /chrome [header|editor|footer|status]",
		getArgumentCompletions: (prefix: string) => {
			const action = prefix.trim();
			const options = [...SURFACES, "status"].filter((option) => option.startsWith(action));
			return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const sub = args.trim().toLowerCase();

			if (sub === "status") {
				const on = SURFACES.filter((surface) => active[surface]).join(", ") || "none";
				ctx.ui.notify(`chrome: ${enabled ? on : "disabled"}`, "info");
				return;
			}
			if ((SURFACES as readonly string[]).includes(sub)) {
				const surface = sub as Surface;
				active[surface] = !active[surface];
				install(ctx);
				ctx.ui.notify(`chrome ${surface} ${active[surface] ? "on" : "off"}`, "info");
				return;
			}
			if (sub === "") {
				enabled = !enabled;
				install(ctx);
				ctx.ui.notify(`chrome ${enabled ? "on" : "off"}`, "info");
				return;
			}
			ctx.ui.notify("usage: /chrome [header|editor|footer|status]", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
	});
}
