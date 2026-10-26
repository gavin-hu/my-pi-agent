/**
 * The `/bytefly` surface: one command, `/bytefly [doctor] [settings] [skills] [update] [upgrade] [extension] [refresh]`.
 *
 * Without a section word it opens the extension screen: the dock in `tui`, the
 * grouped listing elsewhere. `settings` opens the Settings section, or prints
 * its grouped listing outside `tui` without resolving packages. `skills` opens
 * the Skills section and lists the resolved skills in text modes. `update`
 * re-runs the published-version check and reports what it found, which is the
 * one place a request is made on demand; `upgrade` asks Pi's own package manager
 * to install what that check found, behind a confirmation, so the two verbs stay
 * one job each — ask, and act. With `doctor` it produces the doctor
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
import { createSettingsStores, discoverResources, type DiscoveryDeps } from "../picker/discovery.ts";
import { createPickerRuntime, type PickerRuntime } from "../picker/runtime.ts";
import type { Discovery } from "../picker/types.ts";
import { usageRecords } from "../footer/collect/entries.ts";
import { loadByteflyConfig } from "../footer/price/config.ts";
import { createPricer } from "../footer/price/price.ts";
import { formatListing, formatSettingsListing, SKILL_NOUN } from "./format.ts";
import { pricesReport } from "./prices.ts";
import { buildPanelModel, buildSkillModel, extensionName } from "./join.ts";
import { createSettingsRuntime, type SettingsRuntime, type SettingsRuntimeDeps } from "./settings-runtime.ts";
import { loadSkillIndex, resolvedSkillPaths, type SkillIndex } from "./skills.ts";
import { shippedThemeNames } from "./themes.ts";
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
	/** The skill-metadata seam; `loadSkillIndex` unless a test supplies one. */
	skills?: (paths: readonly string[], cwd: string, agentDir: string) => SkillIndex;
}

/**
 * Names `/bytefly <name>` accepts: every declared extension, plus the directory
 * of any resource in either discovery view. Reading both views keeps a
 * project-only name valid before the screen has switched to Project scope.
 */
function selectableNames(discovery: Discovery): Set<string> {
	const names = new Set<string>(Object.keys(REQUIREMENTS));
	for (const item of [...discovery.extensions.global, ...discovery.extensions.effective]) {
		names.add(extensionName(item.path));
	}
	return names;
}

/** The values a bare `/bytefly <tab>` offers, in screen order. */
const FIRST_TOKENS = [
	"doctor",
	"prices",
	"settings",
	"skills",
	"update",
	"upgrade",
	...Object.keys(REQUIREMENTS),
	"refresh",
] as const;

/**
 * Argument completions. The host replaces the whole argument text with the
 * returned `value`, so a second token returns the full `doctor <name>` or
 * `<name> refresh` argument rather than just the word. `/bytefly settings`,
 * `/bytefly skills`, `/bytefly update`, and `/bytefly upgrade` take no name, and
 * `refresh` is never followed by another token.
 */
function completions(prefix: string): Array<{ value: string; label: string }> | null {
	const [first = "", second, ...rest] = prefix.trimStart().split(/\s+/);
	if (rest.length > 0) return null;
	if (second === undefined) {
		const options = FIRST_TOKENS.filter((option) => option.startsWith(first));
		return options.length > 0 ? options.map((option) => ({ value: `${option} `, label: option })) : null;
	}
	if (first === "settings" || first === "skills" || first === "refresh" || first === "update" || first === "upgrade")
		return null;
	const options = (first === "doctor" ? [...Object.keys(REQUIREMENTS), "refresh"] : ["refresh"]).filter((option) =>
		option.startsWith(second),
	);
	return options.length > 0 ? options.map((option) => ({ value: `${first} ${option}`, label: option })) : null;
}

/** Which bytefly surface the arguments select. */
type PanelMode = "screen" | "doctor" | "update" | "upgrade" | "prices";

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

/** Parse `/bytefly [doctor] [settings] [skills] [update] [extension] [refresh]`; extra tokens are ignored. */
function parseArgs(args: string): PanelArgs {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const refresh = parts.includes("refresh");
	const rest = parts.filter((part) => part !== "refresh");
	if (rest[0] === "doctor") return { mode: "doctor", section: "extensions", name: rest[1], refresh };
	// `update` is already a refresh of the published version, so a stray `refresh`
	// beside it is accepted and ignored rather than refused.
	if (rest[0] === "update") return { mode: "update", section: "extensions", refresh };
	// `upgrade` is the same subject as `update`, one verb further: it installs what a
	// check found. Refusing to fold them into one word is what keeps a command that
	// writes behind a confirmation instead of behind an argument.
	if (rest[0] === "upgrade") return { mode: "upgrade", section: "extensions", refresh };
	// `prices` answers a question about this session's totals, so it takes no name and
	// no refresh: it prices what the session holds, once, when asked.
	if (rest[0] === "prices") return { mode: "prices", section: "extensions", refresh };
	if (rest[0] === "settings") return { mode: "screen", section: "settings", name: rest[1], refresh };
	if (rest[0] === "skills") return { mode: "screen", section: "skills", name: rest[1], refresh };
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
	runtime: PickerRuntime,
): void {
	const report = reports.find((entry) => entry.extension === name);
	if (report) {
		ctx.ui.notify(formatExtension(report), hasProblems([report]) ? "warning" : "info");
		return;
	}
	const item = runtime.items("extensions").find((entry) => extensionName(entry.path) === name);
	ctx.ui.notify(
		item
			? `bytefly: ${sanitizeLine(item.path)} — no doctor report`
			: `bytefly: no extension named "${sanitizeLine(name)}"`,
		"info",
	);
}

/**
 * Theme names the row offers: the host's resolved list, narrowed to this
 * package's own palettes. The list is empty outside the TUI (RPC, print, JSON),
 * where the row still shows the stored value.
 */
function settingsThemeNames(ctx: ExtensionCommandContext): string[] {
	try {
		return shippedThemeNames(ctx.ui.getAllThemes());
	} catch {
		return [];
	}
}

/** Register the single `/bytefly` command. */
export function registerPanel(pi: ExtensionAPI, deps: PanelCommandDeps): void {
	const discover = deps.discover ?? discoverResources;
	const makeSettings = deps.settings ?? createSettingsRuntime;
	const loadSkills = deps.skills ?? loadSkillIndex;

	const handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const { mode, section, name, refresh } = parseArgs(args);
		// Only the Extensions section takes an extension argument; a stray word is a
		// typo, not a filter, so say so rather than ignoring it.
		if (section !== "extensions" && name !== undefined) {
			ctx.ui.notify(`bytefly: /bytefly ${section} takes no extension name (got "${sanitizeLine(name)}").`, "warning");
			return;
		}
		const cwd = ctx.cwd ?? process.cwd();
		// `/bytefly prices` answers one question about the session and resolves nothing: it
		// prices what the transcript already recorded and names what that left out. It runs
		// in every mode, because the footer that would carry the same fact exists only in
		// `tui`.
		if (mode === "prices") {
			const config = loadByteflyConfig(cwd);
			const active = ctx.model ? { provider: ctx.model.provider, model: ctx.model.id } : undefined;
			const scanned = usageRecords(ctx.sessionManager.getEntries(), active);
			ctx.ui.notify(pricesReport(createPricer(config)(scanned.records), config.currency).join("\n"), "info");
			return;
		}

		const agentDir = getAgentDir();
		const trusted = ctx.isProjectTrusted();
		const themes = settingsThemeNames(ctx);
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

		// `/bytefly upgrade` is the only path here that writes, and it writes outside
		// the session: Pi's package manager replaces the installed files, so the
		// confirmation and the reload line are part of the answer, not decoration.
		if (mode === "upgrade") {
			const confirmed = await ctx.ui.confirm(
				"Update packages?",
				`Run Pi's package manager for every configured package, then reload to use it.`,
			);
			if (!confirmed) {
				ctx.ui.notify("bytefly: update cancelled.", "info");
				return;
			}
			const outcome = await deps.update.apply();
			const { text, severity } = updateOutcomeText(outcome, pkg.version);
			ctx.ui.notify(text, severity);
			return;
		}

		// Settings outside `tui` prints its grouped listing without resolving
		// packages or probing the doctor.
		if (section === "settings" && ctx.mode !== "tui") {
			const stores = createSettingsStores(cwd, agentDir, trusted);
			const settings = makeSettings({ stores, cwd, agentDir, trusted, themes, onError: settingsNotice });
			ctx.ui.notify(formatSettingsListing(settings.views("global")), "info");
			return;
		}

		let discovery: Discovery;
		try {
			discovery = await discover({ cwd, agentDir, trusted });
		} catch (error) {
			ctx.ui.notify(`Could not list resources: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}

		const settings = makeSettings({
			stores: discovery.stores,
			cwd,
			agentDir,
			trusted: discovery.trusted,
			themes,
			onError: settingsNotice,
		});

		const runtime = createPickerRuntime({
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

		// Skills outside `tui` print the same grouped listing, from the metadata Pi's
		// loader reads; there is no report to probe for and no package to resolve.
		if (section === "skills" && ctx.mode !== "tui") {
			const index = loadSkills(resolvedSkillPaths(discovery), cwd, agentDir);
			const model = buildSkillModel({ items: runtime.items("skills"), index, agentDir });
			ctx.ui.notify(
				formatListing(model, runtime.scope(), { noun: SKILL_NOUN, emptyLabel: "No skills found." }),
				"info",
			);
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
			const model = buildPanelModel({ items: runtime.items("extensions"), reports, agentDir });
			ctx.ui.notify(formatListing(model, runtime.scope()), "info");
			return;
		}

		// The dock screen owns the editor slot; hide the rails for its lifetime.
		await withRailsSuppressed(pi, () =>
			ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const unsubscribe = runtime.onChange(() => tui.requestRender());
				// The settings runtime re-reads its snapshot after a write; without a
				// subscriber that repaint depends on every write chain's own callback.
				const unsubscribeSettings = settings.onChange(() => tui.requestRender());
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
					skills: () => loadSkills(resolvedSkillPaths(discovery), cwd, agentDir),
					refresh: async (force) => {
						reports = await deps.doctor.probeAll({ refresh: force === true });
					},
					onClose: () => {
						// A late error falls back to the transcript, never a disposed screen.
						panel = undefined;
						unsubscribe();
						unsubscribeSettings();
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
			"Open the bytefly control center: /bytefly [extension] [refresh] lists extensions, /bytefly skills lists skills, /bytefly settings opens settings; /bytefly doctor [extension] [refresh] prints the doctor report",
		getArgumentCompletions: completions,
		handler,
	});
}
