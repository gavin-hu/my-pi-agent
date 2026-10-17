/**
 * The `/bytefly` surface: one command, `/bytefly [doctor] [extension] [refresh]`.
 *
 * Without `doctor` it opens the extension screen: the dock in `tui`, the
 * grouped listing elsewhere. With `doctor` it produces the doctor report — the
 * same text `run_doctor` returns — for the whole set or one named extension; in
 * `tui` the report is the dock screen. Discovery, the doctor probe, and the
 * dirty-to-reload confirm all live here. The doctor runtime is injected by the
 * composition root, so `run_doctor` and the screen keep reading one cache.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../../lib/format.ts";
import { withRailsSuppressed } from "../../../lib/rails.ts";
import { REQUIREMENTS, type ExtensionReport } from "../../../lib/requirements.ts";
import { formatExtension, formatReport, hasProblems } from "../doctor/format.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import { discoverExtensions, type DiscoveryDeps } from "../picker/discovery.ts";
import { createExtensionsPickerRuntime, type ExtensionsPickerRuntime } from "../picker/runtime.ts";
import type { Discovery } from "../picker/types.ts";
import { formatListing, formatSettingsHeadline } from "./format.ts";
import { buildPanelModel, extensionName } from "./join.ts";
import { PanelComponent } from "./tui.ts";
import type { PanelSection } from "./types.ts";

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

/** Argument completions: the subcommands, every declared extension, then `refresh`. */
function completions(prefix: string): Array<{ value: string; label: string }> | null {
	const options = ["doctor", "settings", ...Object.keys(REQUIREMENTS), "refresh"].filter((option) =>
		option.startsWith(prefix),
	);
	return options.length > 0 ? options.map((value) => ({ value, label: value })) : null;
}

/** Which bytefly surface the arguments select. */
type PanelMode = "screen" | "doctor";

/** `/bytefly [doctor] [settings] [extension] [refresh]`, parsed. */
interface PanelArgs {
	mode: PanelMode;
	/** The section the screen opens on. */
	section: PanelSection;
	/** The extension to narrow to, when one is named. */
	name?: string;
	/** Re-probe the doctor instead of reusing the session cache. */
	refresh: boolean;
}

/** Parse `/bytefly [doctor] [settings] [extension] [refresh]`; extra tokens are ignored. */
function parseArgs(args: string): PanelArgs {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const refresh = parts.includes("refresh");
	const rest = parts.filter((part) => part !== "refresh");
	if (rest[0] === "doctor") return { mode: "doctor", section: "extensions", name: rest[1], refresh };
	if (rest[0] === "settings") return { mode: "screen", section: "settings", name: rest[1], refresh };
	return { mode: "screen", section: "extensions", name: rest[0], refresh };
}

/**
 * Print one extension's full findings, or say why it has none. The screen's
 * named form and the `doctor` subcommand share this text path.
 */
function notifyExtension(
	ctx: ExtensionCommandContext,
	name: string,
	reports: readonly ExtensionReport[],
	runtime: ExtensionsPickerRuntime,
): void {
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
}

/** Register the single `/bytefly` command. */
export function registerPanel(pi: ExtensionAPI, deps: PanelCommandDeps): void {
	const discover = deps.discover ?? discoverExtensions;

	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const { mode, section, name, refresh } = parseArgs(args);

		// Settings is an empty shell: the other modes print its one-line listing
		// without resolving packages or probing the doctor.
		if (section === "settings" && ctx.mode !== "tui") {
			ctx.ui.notify(formatSettingsHeadline("global"), "info");
			return;
		}

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
		if (name !== undefined && section === "extensions" && !selectableNames(discovery).has(name)) {
			ctx.ui.notify(`bytefly: no extension named "${sanitizeLine(name)}"`, "warning");
			return;
		}

		if (ctx.mode !== "tui") {
			if (name !== undefined) {
				notifyExtension(ctx, name, reports, runtime);
				return;
			}
			if (mode === "doctor") {
				ctx.ui.notify(formatReport(reports), hasProblems(reports) ? "warning" : "info");
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
					filter: section === "extensions" ? name : undefined,
					section,
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

	pi.registerCommand("bytefly", {
		description:
			"Open the bytefly control center: /bytefly [extension] [refresh] lists extensions, /bytefly settings opens settings; /bytefly doctor [extension] [refresh] prints the doctor report",
		getArgumentCompletions: completions,
		handler,
	});
}
