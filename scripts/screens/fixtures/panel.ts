/**
 * The picker panel: its resource list, the health report beside it, and both
 * settings surfaces, drawn from the real catalogue over a fixed snapshot.
 *
 * Every write is refused, so a capture cannot reach `bytefly.json` or
 * `settings.json`.
 */

import { settingViews, type SettingsSnapshot } from "../../../extensions/bytefly/panel/settings.ts";
import type { SkillIndex } from "../../../extensions/bytefly/panel/skills.ts";
import type { PanelComponent } from "../../../extensions/bytefly/panel/tui.ts";
import type { SettingsSurface } from "../../../extensions/bytefly/panel/settings-runtime.ts";
import type { ResourceItem, Settings } from "../../../extensions/bytefly/picker/types.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { packageExtension, packageSkill } from "../../../test/helpers/fixtures/picker.ts";

/**
 * The extension list the `/bytefly` panel shows: this package, half of it
 * enabled. `bytefly` itself is absent, as it is in the product: the picker drops
 * the host's own entrypoint, and its report lands in the `Not resolved` group.
 */
export const PANEL_CWD = "/home/u/repo";
export const PANEL_AGENT_DIR = "/home/u/.pi/agent";
export const PANEL_ITEMS: ResourceItem[] = [
	packageExtension("plan", true),
	packageExtension("subagent", true),
	packageExtension("worktree", true),
	packageExtension("todo", true),
	packageExtension("job", true),
	packageExtension("memory", true),
	packageExtension("file-read", true),
	packageExtension("web-access", false),
	packageExtension("wechat", false),
];
/**
 * The Skills list the same panel shows: the two skills this package ships, as
 * Pi resolves them from `skills/` inside the installed package.
 */
export const PANEL_SKILL_ITEMS: ResourceItem[] = [packageSkill("init"), packageSkill("next"), packageSkill("refactor")];
/** What each `SKILL.md` declares, keyed by the path the panel joins on. */
export const PANEL_SKILL_INDEX: SkillIndex = new Map([
	[
		"/pkg/skills/init/SKILL.md",
		{
			name: "init",
			description:
				"Initialize or refresh a project's agent instructions (AGENTS.md, or AGENTS.override.md when it shadows AGENTS.md) through a built-in interactive interview and a reviewed plan. Run /skill:init to start it.",
			modelHidden: true,
		},
	],
	[
		"/pkg/skills/next/SKILL.md",
		{
			name: "next",
			description:
				"Decide what to do next from the current conversation when it has work in it, or from the project's real state when it is empty: loose work, commits since the last tag, unreleased changelog entries, roadmap or plan items still open, and the project's check command. Returns a short list of suggested next todos in priority order, with the evidence for each and the command that starts it; read-only, it never edits, commits, or begins the work. Use when asked what to do next, where to pick up, what is left, or what to work on now.",
			modelHidden: false,
		},
	],
	[
		"/pkg/skills/refactor/SKILL.md",
		{
			name: "refactor",
			description:
				"Audit a project or path for refactoring opportunities — duplication, oversized modules, coupling, drift, high-churn code with weak tests — and return a ranked shortlist with path:line evidence, or carry one chosen candidate through a behaviour-preserving refactor. Use when asked what to refactor, where the code is tangled, for a refactor audit, or to execute a refactor already agreed; discovery is read-only.",
			modelHidden: false,
		},
	],
]);

/** Health for two extensions: one missing a hard prerequisite, one clean. */
export const PANEL_REPORTS: ExtensionReport[] = [
	makeReport("worktree", [
		makeFinding(
			"git",
			"missing",
			"not found on PATH — worktree isolation",
			"install git and make sure it is on PATH (https://git-scm.com/downloads).",
		),
	]),
	makeReport("bytefly", [makeFinding("npm", "ok", "Latest published version 0.13.1")]),
];
/**
 * The panel needs a settings surface even on its Extensions section. These rows
 * are never rendered here, and every write is refused, so nothing reaches
 * `bytefly.json` or `settings.json`.
 */
export const PANEL_SETTINGS: SettingsSurface = {
	views: () => [],
	change: async () => {},
	setValue: async () => false,
	reset: async () => false,
	sectionDocument: () => undefined,
	isDirty: () => false,
};

/** The Settings section's snapshot: a few stored values over the real catalogue. */
const PANEL_SETTINGS_SNAPSHOT: SettingsSnapshot = {
	app: { theme: "bytefly-dark" } as Settings,
	global: {
		notify: { enabled: true, method: "osascript" },
		price: { currency: { code: "CNY", decimals: 2 }, budget: 5 },
		job: { wakeOnFinish: true },
	},
	project: {},
	themes: ["system", "bytefly-dark", "bytefly-light"],
};

/**
 * Focus the row whose line names `label`, for a capture that has to show what a
 * focused row looks like. Only navigation keys are sent, so nothing is written.
 */
export function focusRow(panel: PanelComponent, label: string, width: number): void {
	for (let step = 0; step < 24; step += 1) {
		// The row's marker is painted, so the line opens with an escape sequence
		// rather than with `❯`; the label is what tells the two apart.
		const selected = panel.render(width).find((line) => line.includes("❯"));
		if (selected !== undefined && selected.includes(label)) return;
		panel.handleInput("j");
	}
}

/**
 * The Settings section as the capture draws it: the real catalogue over a fixed
 * snapshot. Every write is refused, so a capture cannot reach `bytefly.json` or
 * `settings.json`.
 */
export const PANEL_SETTING_VIEWS: SettingsSurface = {
	views: (scope) => settingViews(PANEL_SETTINGS_SNAPSHOT, scope),
	change: async () => {},
	setValue: async () => false,
	reset: async () => false,
	sectionDocument: (scope, section) =>
		(scope === "global" ? PANEL_SETTINGS_SNAPSHOT.global : PANEL_SETTINGS_SNAPSHOT.project)[section],
	isDirty: () => false,
};
