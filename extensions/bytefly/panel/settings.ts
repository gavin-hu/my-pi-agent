/**
 * The Settings section's catalogue and value arithmetic.
 *
 * A row is one preference: an app setting from Pi's `settings.json`, or a key
 * in a `bytefly.json` section. This module is pure — descriptors, a snapshot to
 * views, cycling, validation, and grouping — so the screen and the runtime share
 * one definition and the tests need no host.
 *
 * The catalogue is deliberately curated. The schema walker is a later step;
 * five rows prove the row types (boolean checkbox, enum cycle), both scopes,
 * and both write paths first.
 */

import { configSection } from "../../../lib/config.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { DEFAULT_CHROME_CONFIG, normalizeChromeConfig } from "../chrome.ts";
import { DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig } from "../notify/config.ts";
import type { Settings, WriteScope } from "../picker/types.ts";

/** Where a preference is stored. */
export type SettingSource = "app" | "bytefly";

/** The row control a preference uses. */
export type SettingKind = "boolean" | "enum";

/** Where the effective value came from. */
export type SettingOrigin = "default" | "global" | "project" | "inherited";

/** One curated value a row can take. */
export interface SettingOption {
	value: string;
	label: string;
}

/** One heading in the Settings list. */
export interface SettingGroup {
	key: string;
	label: string;
}

/** A `bytefly.json` location for a row. */
type SettingConfig = { section: "notify"; key: "enabled" } | { section: "chrome"; key: "rail" };

/** The static definition of one preference. */
export interface SettingDescriptor {
	/** Stable identity, also the focus key. */
	id: string;
	/** Group key from {@link SETTING_GROUPS}. */
	group: string;
	label: string;
	description: string;
	source: SettingSource;
	kind: SettingKind;
	/** Curated values, in cycle order. */
	options: readonly SettingOption[];
	/** The value shown when neither file sets the key. */
	fallback: string;
	/** For `bytefly` rows: the section and key this row edits. */
	config?: SettingConfig;
}

/** A row with the value read from one scope. */
export interface SettingView extends SettingDescriptor {
	/** The effective raw value; a bytefly row may hold a valid custom value. */
	value: string;
	/** The display label for {@link value}. */
	valueLabel: string;
	origin: SettingOrigin;
}

/** The two config documents and the personal settings a render reads. */
export interface SettingsSnapshot {
	app: Settings;
	global: Record<string, unknown>;
	project: Record<string, unknown>;
}

/** One rendered group: its heading and the rows under it. */
export interface GroupedSettings {
	key: string;
	label: string;
	views: SettingView[];
}

/** Group order on screen. */
export const SETTING_GROUPS: readonly SettingGroup[] = [
	{ key: "startup", label: "Startup" },
	{ key: "notifications", label: "Notifications" },
	{ key: "transcript", label: "Transcript" },
	{ key: "terminal", label: "Terminal" },
];

const ON_OFF: readonly SettingOption[] = [
	{ value: "false", label: "Off" },
	{ value: "true", label: "On" },
];

/** Rail glyphs offered in the curated picker; every one is one column. */
const RAIL_OPTIONS: readonly SettingOption[] = [
	{ value: GLYPHS.divider, label: GLYPHS.divider },
	{ value: "│", label: "│" },
	{ value: "┃", label: "┃" },
	{ value: "▏", label: "▏" },
];

/** The v1 catalogue, in screen order. */
export const SETTING_ROWS: readonly SettingDescriptor[] = [
	{
		id: "quietStartup",
		group: "startup",
		label: "Quiet startup",
		description: "Hide Pi's startup detail. Header only keeps the header and hides the loaded-resource listing.",
		source: "app",
		kind: "enum",
		fallback: "false",
		options: [
			{ value: "false", label: "Full" },
			{ value: "header", label: "Header only" },
			{ value: "true", label: "Quiet" },
		],
	},
	{
		id: "notify.enabled",
		group: "notifications",
		label: "Desktop notifications",
		description: "Raise an OS notification when a run or job finishes, or the agent asks for input.",
		source: "bytefly",
		kind: "boolean",
		fallback: "false",
		options: ON_OFF,
		config: { section: "notify", key: "enabled" },
	},
	{
		id: "chrome.rail",
		group: "transcript",
		label: "Rail glyph",
		description: "The single-column glyph that leads a tool result or notice body.",
		source: "bytefly",
		kind: "enum",
		fallback: GLYPHS.divider,
		options: RAIL_OPTIONS,
		config: { section: "chrome", key: "rail" },
	},
	{
		id: "outputPad",
		group: "transcript",
		label: "Output padding",
		description: "Pi's transcript padding; bytefly's header and blocks follow it.",
		source: "app",
		kind: "enum",
		fallback: "1",
		options: [
			{ value: "0", label: "0" },
			{ value: "1", label: "1" },
		],
	},
	{
		id: "showHardwareCursor",
		group: "terminal",
		label: "Hardware cursor",
		description: "Use the terminal cursor instead of Pi's drawn cursor.",
		source: "app",
		kind: "boolean",
		fallback: "false",
		options: ON_OFF,
	},
];

/** The rows a scope can write: app rows are personal-file only. */
export function rowsForScope(scope: WriteScope): readonly SettingDescriptor[] {
	return scope === "global" ? SETTING_ROWS : SETTING_ROWS.filter((row) => row.source === "bytefly");
}

/** The number of rows the section shows for `scope`. */
export function countSettings(scope: WriteScope): number {
	return rowsForScope(scope).length;
}

/** Whether `raw` is one of a row's curated options. */
export function validValue(row: SettingDescriptor, raw: string): boolean {
	return row.options.some((option) => option.value === raw);
}

/** The display label for `raw`, or the raw value when it is a valid custom one. */
function labelFor(row: SettingDescriptor, raw: string): string {
	return row.options.find((option) => option.value === raw)?.label ?? raw;
}

/** Read an app preference and where it came from. */
function appValue(snapshot: SettingsSnapshot, row: SettingDescriptor): { value: string; origin: SettingOrigin } {
	switch (row.id) {
		case "quietStartup": {
			const quiet = snapshot.app.quietStartup;
			const value = quiet === true ? "true" : quiet === "header" ? "header" : "false";
			return { value, origin: quiet === undefined ? "default" : "global" };
		}
		case "outputPad":
			return {
				value: snapshot.app.outputPad === 0 ? "0" : "1",
				origin: snapshot.app.outputPad === undefined ? "default" : "global",
			};
		case "showHardwareCursor":
			return {
				value: snapshot.app.showHardwareCursor === true ? "true" : "false",
				origin: snapshot.app.showHardwareCursor === undefined ? "default" : "global",
			};
		default:
			throw new Error(`Unknown app setting ${row.id}`);
	}
}

/** Whether a project section sets `key`, so the origin is truthful. */
function originFor(config: SettingConfig, snapshot: SettingsSnapshot, scope: WriteScope): SettingOrigin {
	const globalRaw = configSection(snapshot.global, config.section);
	const projectRaw = scope === "project" ? configSection(snapshot.project, config.section) : undefined;
	if (projectRaw && config.key in projectRaw) return "project";
	if (scope === "project") return "inherited";
	return globalRaw && config.key in globalRaw ? "global" : "default";
}

/** Read a `bytefly.json` preference, normalized over the global section. */
function byteflyValue(
	snapshot: SettingsSnapshot,
	row: SettingDescriptor,
	scope: WriteScope,
): { value: string; origin: SettingOrigin } {
	const config = row.config;
	if (!config) throw new Error(`Setting ${row.id} has no config section`);
	const globalRaw = configSection(snapshot.global, config.section);
	const projectRaw = scope === "project" ? configSection(snapshot.project, config.section) : undefined;
	const origin = originFor(config, snapshot, scope);
	if (config.section === "notify") {
		const global = normalizeNotifyConfig(globalRaw, DEFAULT_NOTIFY_CONFIG);
		const effective = normalizeNotifyConfig(projectRaw, global);
		return { value: effective.enabled ? "true" : "false", origin };
	}
	const global = normalizeChromeConfig(globalRaw, DEFAULT_CHROME_CONFIG);
	const effective = normalizeChromeConfig(projectRaw, global);
	return { value: effective.rail, origin };
}

/** Build the rows for `scope` from a snapshot. */
export function settingViews(snapshot: SettingsSnapshot, scope: WriteScope): SettingView[] {
	return rowsForScope(scope).map((row) => {
		const { value, origin } = row.source === "app" ? appValue(snapshot, row) : byteflyValue(snapshot, row, scope);
		return { ...row, value, valueLabel: labelFor(row, value), origin };
	});
}

/** The next curated value, wrapping; an uncurated value starts the cycle. */
export function nextValue(row: SettingDescriptor, current: string): SettingOption {
	const index = row.options.findIndex((option) => option.value === current);
	return row.options[(index + 1) % row.options.length] as SettingOption;
}

/** The JSON value a raw option stores, per row. */
export function storedValue(row: SettingDescriptor, raw: string): unknown {
	switch (row.id) {
		case "quietStartup":
			return raw === "true" ? true : raw === "header" ? "header" : false;
		case "outputPad":
			return raw === "1" ? 1 : 0;
		case "notify.enabled":
		case "showHardwareCursor":
			return raw === "true";
		case "chrome.rail":
			return raw;
		default:
			throw new Error(`Unknown setting ${row.id}`);
	}
}

/** Group views in screen order, dropping empty groups. */
export function groupViews(views: readonly SettingView[]): GroupedSettings[] {
	return SETTING_GROUPS.map((group) => ({
		key: group.key,
		label: group.label,
		views: views.filter((view) => view.group === group.key),
	})).filter((group) => group.views.length > 0);
}
