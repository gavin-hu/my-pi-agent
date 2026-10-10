/**
 * The `/extensions` command.
 *
 * In a terminal session it opens the dock list, where Space toggles the focused
 * extension and Tab switches between Global and Project settings. Everywhere
 * else it prints the same list as text. After the screen closes with pending
 * changes it offers to reload so the new selection takes effect.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { withRailsSuppressed } from "../../lib/rails.ts";
import { discoverExtensions, type DiscoveryDeps } from "./discovery.ts";
import { formatListing } from "./resources.ts";
import { createExtensionsManagerRuntime } from "./runtime.ts";
import { ExtensionsListComponent } from "./tui.ts";

/** Host seams, injected by tests. */
export interface CommandDeps {
	discover?: (deps: DiscoveryDeps) => Promise<Awaited<ReturnType<typeof discoverExtensions>>>;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps = {}): void {
	const discover = deps.discover ?? discoverExtensions;

	pi.registerCommand("extensions", {
		description: "List and enable/disable extensions",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd ?? process.cwd();
			const agentDir = getAgentDir();
			const discovery = await discover({ cwd, agentDir, trusted: ctx.isProjectTrusted() });
			const runtime = createExtensionsManagerRuntime({
				discovery,
				cwd,
				agentDir,
				onError: (message) => ctx.ui.notify(message, "error"),
			});

			if (ctx.mode !== "tui") {
				ctx.ui.notify(formatListing(runtime.items(), agentDir), "info");
				return;
			}

			await withRailsSuppressed(pi, () =>
				ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
					const unsubscribe = runtime.onChange(() => tui.requestRender());
					return new ExtensionsListComponent(
						runtime,
						theme,
						agentDir,
						() => {
							unsubscribe();
							done();
						},
						() => tui.requestRender(),
						() => tui.terminal?.rows,
						(message) => ctx.ui.notify(message, "warning"),
					);
				}),
			);

			if (!runtime.isDirty()) return;
			const reload = await ctx.ui.confirm("Reload to apply changes?", "Extension changes take effect after a reload.");
			if (reload) await ctx.reload();
		},
	});
}
