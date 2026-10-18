/**
 * The `/bytefly` surface: one command, `/bytefly [doctor] [settings] [update] [extension] [refresh]`.
 *
 * Without `doctor` it opens the extension screen: the dock in `tui`, the
 * grouped listing elsewhere. `settings` opens the Settings section, or prints
 * its grouped listing outside `tui` without resolving packages. `update`
 * re-runs the published-version check and reports what it found, which is the
 * one place a request is made on demand. With `doctor` it produces the doctor
 * report — the same text `run_doctor` returns — for the whole set or one named
 * extension; in `tui` the report is the dock screen. Discovery, the doctor
 * probe, and the dirty-to-reload confirm all live here. The doctor runtime and
 * the update handle are injected by the composition root, so `run_doctor` and
 * the screen keep reading one cache, and the command paints the marker it finds.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { sanitizeLine } from "../../../lib/format.ts";
import { withRailsSuppressed } from "../../../lib/rails.ts";
import { REQUIREMENTS, type ExtensionReport } from "../../../lib/requirements.ts";
import { formatExtension, formatReport, hasProblems } from "../doctor/format.ts";
import type { DoctorRuntime } from "../doctor/runtime.ts";
import { updateOutcomeText } from "../update/format.ts";
import type { UpdateHandle } from "../update/register.ts";
import { createSettingsStores, discoverExtensions, type DiscoveryDeps } from "../picker/discovery.ts";
import { createExtensionsPickerRuntime, type ExtensionsPickerRuntime } from "../picker/runtime.ts";
import type { Discovery } from "../picker/types.ts";
import { formatListing, formatSettingsListing } from "./format.ts";
import { buildPanelModel, extensionName } from "./join.ts";
import { createSettingsRuntime, type SettingsRuntime, type SettingsRuntimeDeps } from "./settings-runtime.ts";
import { PanelComponent } from "./tui.ts";
import type { PanelSection } from "./types.ts";

/** Host seams for the panel command, injected by tests and the composition root. */
export interface PanelCommandDeps {
	/** The doctor runtime created by `registerDoctor`; shared with `run_doctor`. */
	doctor: DoctorRuntime;
	/** The update handle `registerUpdate` returns, for `/bytefly update`. */
	update: UpdateHandle;
	/** The picker's discovery seam. */
	discover?: (deps: DiscoveryDeps) => Promise<Discovery>;
	/** The Settings runtime seam. */
	settings?: (deps: SettingsRuntimeDeps) => SettingsRuntime;
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

/** The values a bare `/bytefly <tab>` offers, in screen order. */
const FIRST_TOKENS = ["doctor", "settings", "update", ...Object.keys(REQUIREMENTS), "refresh"] as const;

/**
 * Argument completions. The host replaces the whole argument text with the
 * returned `value`, so a second token returns the full `doctor <name>` or
 * `<name> refresh` argument rather than just the word. `/bytefly settings` and
 * `/bytefly update` take no name, and `refresh` is never followed by another
 * token.
 */
function completions(prefix: string): Array<{ value: string; label: string }> | null {
	const [first = "", second, ...rest] = prefix.trimStart().split(/\s+/);
	if (rest.length > 0) return null;
	if (second === undefined) {
		const options = FIRST_TOKENS.filter((option) => option.startsWith(first));
		return options.length > 0 ? options.map((option) => ({ value: `${option} `, label: option })) : null;
	}
	if (first === "settings" || first === "refresh" || first === "update") return null;
	const options = (first === "doctor" ? [...Object.keys(REQUIREMENTS), "refresh"] : ["refresh"]).filter((option) =>
		option.startsWith(second),
	);
	return options.length > 0 ? options.map((option) => ({ value: `${first} ${option}`, label: option })) : null;
}

/** Which bytefly surface the arguments select. */
type PanelMode = "screen" | "doctor" | "update";

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

/** Parse `/bytefly [doctor] [settings] [update] [extension] [refresh]`; extra tokens are ignored. */
function parseArgs(args: string): PanelArgs {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const refresh = parts.includes("refresh");
	const rest = parts.filter((part) => part !== "refresh");
	if (rest[0] === "doctor") return { mode: "doctor", section: "extensions", name: rest[1], refresh };
	// `update` is already a refresh of the published version, so a stray `refresh`
	// beside it is accepted and ignored rather than refused.
	if (rest[0] === "update") return { mode: "update", section: "extensions", refresh };
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
	const makeSettings = deps.settings ?? createSettingsRuntime;

	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const { mode, section, name, refresh } = parseArgs(args);
		// `/bytefly settings` has no extension argument; a stray word is a typo, not
		// a filter, so say so rather than ignoring it.
		if (section === "settings" && name !== undefined) {
			ctx.ui.notify(`bytefly: /bytefly settings takes no extension name (got "${sanitizeLine(name)}").`, "warning");
			return;
		}
		const cwd = ctx.cwd ?? process.cwd();
		const agentDir = getAgentDir();
		const trusted = ctx.isProjectTrusted();
		// The mounted screen owns its feedback: a refusal or a failed write belongs in
		// the frame, not appended to the transcript behind it. Before the screen
		// exists (the non-TUI settings path, a pre-mount failure) the transcript is
		// the only surface.
		let panel: PanelComponent | undefined;
		const surfaceNotice = (message: string, kind: "warning" | "error" = "warning"): void => {
			if (panel) panel.notify(message);
			else ctx.ui.notify(message, kind);
		};
		const settingsNotice = (message: string): void => surfaceNotice(message, "warning");

		// `/bytefly update` answers one question and resolves nothing: no package
		// discovery, no doctor probe, no screen. It is the one path a version check
		// takes on demand, so the request happens here and nowhere else.
		if (mode === "update") {
			const outcome = await deps.update.recheck();
			const { text, severity } = updateOutcomeText(outcome, pkg.version);
			ctx.ui.notify(text, severity);
			return;
		}

		// Settings outside `tui` prints its grouped listing without resolving
		// packages or probing the doctor.
		if (section === "settings" && ctx.mode !== "tui") {
			const stores = createSettingsStores(cwd, agentDir, trusted);
			const settings = makeSettings({ stores, cwd, agentDir, trusted, onError: settingsNotice });
			ctx.ui.notify(formatSettingsListing(settings.views("global"), "global"), "info");
			return;
		}

		let discovery: Discovery;
		try {
			discovery = await discover({ cwd, agentDir, trusted });
		} catch (error) {
			ctx.ui.notify(`Could not list extensions: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}

		const settings = makeSettings({
			stores: discovery.stores,
			cwd,
			agentDir,
			trusted: discovery.trusted,
			onError: settingsNotice,
		});

		const runtime = createExtensionsPickerRuntime({
			discovery,
			cwd,
			agentDir,
			onError: (message) => surfaceNotice(message, "error"),
		});

		// The name is checked before the probe: a typo should not pay for every
		// prerequisite check, and the set is available as soon as discovery is.
		if (name !== undefined && section === "extensions" && !selectableNames(discovery).has(name)) {
			ctx.ui.notify(`bytefly: no extension named "${sanitizeLine(name)}"`, "warning");
			return;
		}

		// Text modes print the report, so they probe now. The dock screen opens on
		// the session cache and probes on its first Extensions view instead, which
		// keeps `/bytefly` and `/bytefly settings` instant.
		const cached = deps.doctor.peek();
		let reports: ExtensionReport[] = cached ?? [];

		if (ctx.mode !== "tui") {
			try {
				reports = await deps.doctor.probeAll({ refresh });
			} catch (error) {
				ctx.ui.notify(`Could not probe extensions: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
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
				const component = new PanelComponent({
					runtime,
					reports: () => reports,
					settings,
					filter: section === "extensions" ? name : undefined,
					section,
					theme,
					agentDir,
					cwd,
					// A cached session probes only when the command asked for it.
					needsProbe: cached === undefined || refresh,
					initialRefresh: refresh,
					viewportRows: () => tui.terminal?.rows,
					requestRender: () => tui.requestRender(),
					refresh: async (force) => {
						reports = await deps.doctor.probeAll({ refresh: force === true });
					},
					onClose: () => {
						// A late error falls back to the transcript, never a disposed screen.
						panel = undefined;
						unsubscribe();
						done();
					},
				});
				panel = component;
				component.prime();
				return component;
			}),
		);

		if (!runtime.isDirty() && !settings.isDirty()) return;
		const reload = await ctx.ui.confirm("Reload to apply changes?", "Changes take effect after a reload.");
		if (reload) await ctx.reload();
	};

	pi.registerCommand("bytefly", {
		description:
			"Open the bytefly control center: /bytefly [extension] [refresh] lists extensions, /bytefly settings opens settings; /bytefly doctor [extension] [refresh] prints the doctor report",
		getArgumentCompletions: completions,
		handler,
	});
}
