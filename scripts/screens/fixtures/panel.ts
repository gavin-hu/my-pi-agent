/**
 * The picker panel: its resource list, the health report beside it, and both
 * settings surfaces, drawn from the real catalogue over a fixed snapshot.
 *
 * Every write is refused, so a capture cannot reach `bytefly.json` or
 * `settings.json`.
 */

import { settingViews, type SettingsSnapshot } from "../../../extensions/bytefly/panel/settings.ts";
import type { SettingsSurface } from "../../../extensions/bytefly/panel/settings-runtime.ts";
import type { ResourceItem, Settings } from "../../../extensions/bytefly/picker/types.ts";
import type { ExtensionReport } from "../../../lib/requirements.ts";
import { makeFinding, makeReport } from "../../../test/helpers/fixtures/doctor.ts";
import { packageExtension } from "../../../test/helpers/fixtures/picker.ts";

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
