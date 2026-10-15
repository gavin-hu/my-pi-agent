/**
 * The `/bytefly` surface: one runner that opens the unified panel, with
 * `/extensions` and `/doctor` registered against the same handler.
 *
 * In `tui` mode it mounts the dock screen; every other mode prints the same
 * information as text. Discovery, the doctor probe, and the dirty-to-reload
 * confirm all live here, so the three command names cannot drift. The doctor
 * runtime is injected by the composition root, so `run_doctor` and the screen
 * keep reading one session cache.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../lib/format.ts";
import { withRailsSuppressed } from "../../../lib/rails.ts";
import { REQUIREMENTS, type ExtensionReport } from "../../../lib/requirements.ts";
import { formatExtension, hasProblems } from "../doctor/format.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import { discoverExtensions, type DiscoveryDeps } from "../picker/discovery.ts";
import { createExtensionsPickerRuntime } from "../picker/runtime.ts";
import type { Discovery } from "../picker/types.ts";
import { formatListing } from "./format.ts";
import { buildPanelModel, extensionName } from "./join.ts";
import { PanelComponent } from "./tui.ts";

/** Host seams for the panel command, injected by tests and the composition root. */
export interface PanelCommandDeps {
	/** The doctor runtime created by `registerDoctor`; shared with `run_doctor`. */
	doctor: DoctorRuntime;
	/** The picker's discovery seam. */
	discover?: (deps: DiscoveryDeps) => Promise<Discovery>;
}

/**
 * Names `/bytefly <name>` accepts: every declared extension, plus the directory
 * of any resource in either discovery view. Reading both views keeps a
 * project-only name valid before the screen has switched to Project scope.
 */
function selectableNames(discovery: Discovery): Set<string> {
	const names = new Set<string>(Object.keys(REQUIREMENTS));
	for (const item of [...discovery.global, ...discovery.effective]) names.add(extensionName(item.path));
	return names;
}

/** The shared completion list: every declared extension, then `refresh`. */
function completions(prefix: string): Array<{ value: string; label: string }> | null {
	const options = [...Object.keys(REQUIREMENTS), "refresh"].filter((option) => option.startsWith(prefix));
	return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
}

/** Register `/bytefly`, `/extensions`, and `/doctor` against one runner. */
export function registerPanel(pi: ExtensionAPI, deps: PanelCommandDeps): void {
	const discover = deps.discover ?? discoverExtensions;

	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const parts = args.trim().split(/\s+/).filter(Boolean);
		const refresh = parts.includes("refresh");
		const name = parts.find((part) => part !== "refresh");

		const cwd = ctx.cwd ?? process.cwd();
		const agentDir = getAgentDir();
		let discovery: Discovery;
		try {
			discovery = await discover({ cwd, agentDir, trusted: ctx.isProjectTrusted() });
		} catch (error) {
			ctx.ui.notify(`Could not list extensions: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}

		const runtime = createExtensionsPickerRuntime({
			discovery,
			cwd,
			agentDir,
			onError: (message) => ctx.ui.notify(message, "error"),
		});

		let reports: ExtensionReport[];
		try {
			reports = await deps.doctor.probeAll({ refresh });
		} catch (error) {
			ctx.ui.notify(`Could not probe extensions: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		if (name !== undefined && !selectableNames(discovery).has(name)) {
			ctx.ui.notify(`bytefly: no extension named "${sanitizeLine(name)}"`, "warning");
			return;
		}

		if (ctx.mode !== "tui") {
			if (name !== undefined) {
				const report = reports.find((entry) => entry.extension === name);
				if (report) {
					ctx.ui.notify(formatExtension(report), hasProblems([report]) ? "warning" : "info");
					return;
				}
				const item = runtime.items().find((entry) => extensionName(entry.path) === name);
				ctx.ui.notify(
					item
						? `bytefly: ${sanitizeLine(item.path)} — no doctor report`
						: `bytefly: no extension named "${sanitizeLine(name)}"`,
					"info",
				);
				return;
			}
			const model = buildPanelModel({ items: runtime.items(), reports, agentDir });
			ctx.ui.notify(formatListing(model, runtime.scope()), "info");
			return;
		}

		// The dock screen owns the editor slot; hide the rails for its lifetime.
		await withRailsSuppressed(pi, () =>
			ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const unsubscribe = runtime.onChange(() => tui.requestRender());
				return new PanelComponent({
					runtime,
					reports: () => reports,
					filter: name,
					theme,
					agentDir,
					viewportRows: () => tui.terminal?.rows,
					requestRender: () => tui.requestRender(),
					refresh: async () => {
						reports = await deps.doctor.probeAll({ refresh: true });
					},
					onClose: () => {
						unsubscribe();
						done();
					},
					onNotice: (message) => ctx.ui.notify(message, "warning"),
				});
			}),
		);

		if (!runtime.isDirty()) return;
		const reload = await ctx.ui.confirm("Reload to apply changes?", "Extension changes take effect after a reload.");
		if (reload) await ctx.reload();
	};

	const descriptions: Array<[string, string]> = [
		["bytefly", "Open the bytefly extension screen: /bytefly [extension] [refresh]"],
		["extensions", "List and enable/disable extensions"],
		["doctor", "Check that every extension has what it needs: /doctor [extension] [refresh]"],
	];
	for (const [command, description] of descriptions) {
		pi.registerCommand(command, { description, getArgumentCompletions: completions, handler });
	}
}
