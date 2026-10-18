/**
 * The Settings section's catalogue and value arithmetic.
 *
 * A row is one preference: an app setting from Pi's `settings.json`, or a leaf
 * of a `bytefly.json` section. This module is pure — descriptors, a snapshot to
 * views, cycling, validation, and grouping — so the screen and the runtime share
 * one definition and the tests need no host.
 *
 * The catalogue is deliberately curated: one proven row family at a time. It
 * covers scalars (a boolean checkbox, an enum cycle), both scopes, both write
 * paths, and — with `price.currency.decimals` — one nested key. Arrays, nested
 * tariffs, credentials, and free text are still JSON edits.
 */

import { configSection, configValueAt } from "../../../lib/config.ts";
import { GLYPHS } from "../../../lib/tui/glyphs.ts";
import { DEFAULT_CHROME_CONFIG, normalizeChromeConfig } from "../chrome.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG, normalizeConfig as normalizeDoctorConfig } from "../doctor/config.ts";
import { DEFAULT_BYTEFLY_CONFIG, DEFAULT_CURRENCY, normalizeByteflyConfig } from "../footer/price/config.ts";
import { DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig } from "../notify/config.ts";
import type { Settings, WriteScope } from "../picker/types.ts";

/** Where a preference is stored. */
export type SettingSource = "app" | "bytefly";

/** The row control a preference uses. */
export type SettingKind = "boolean" | "enum" | "text";

/** Where the effective value came from. */
export type SettingOrigin = "default" | "global" | "project" | "inherited";

/** One curated value a row can take. */
export interface SettingOption {
	value: string;
	label: string;
}

/** What a text row accepts, checked before a write so the file cannot hold less. */
export interface TextRule {
	/** Longest accepted value, in the units the loader slices with. */
	maxLength: number;
	/** Why `raw` cannot be stored, or `undefined` when it can. */
	validate?: (raw: string) => string | undefined;
}

/** One heading in the Settings list. */
export interface SettingGroup {
	key: string;
	label: string;
}

/** The `bytefly.json` sections the Settings section can read and write. */
export type ConfigSectionName = "notify" | "chrome" | "doctor" | "price";

/** Where a `bytefly.json` row lives: a section, and the path to its leaf. */
export interface SettingConfig {
	section: ConfigSectionName;
	path: readonly string[];
}

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
	/** Curated values, in cycle order; empty for a text row. */
	options: readonly SettingOption[];
	/** For `kind: "text"`: the length limit and any rule the value must satisfy. */
	text?: TextRule;
	/** The value shown when neither file sets the key. */
	fallback: string;
	/** The JSON type the row stores; string when omitted. */
	json?: "boolean" | "number";
	/** For `bytefly` rows: the section and leaf path this row edits. */
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
	{ key: "diagnostics", label: "Diagnostics" },
	{ key: "pricing", label: "Pricing" },
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

/** The notify section's delivery methods, labeled by the surface each reaches. */
const METHOD_OPTIONS: readonly SettingOption[] = [
	{ value: "auto", label: "Auto" },
	{ value: "osc777", label: "OSC 777" },
	{ value: "osc99", label: "OSC 99" },
	{ value: "toast", label: "Windows toast" },
	{ value: "osascript", label: "macOS" },
	{ value: "notify-send", label: "Linux" },
];

/** Cost precision 0-4, the range the `price` section clamps `decimals` to. */
const DECIMALS_OPTIONS: readonly SettingOption[] = [0, 1, 2, 3, 4].map((value) => ({
	value: String(value),
	label: String(value),
}));

/** The v1 catalogue, in screen order. */
export const SETTING_ROWS: readonly SettingDescriptor[] = [
	{
		id: "byteflyUi",
		group: "startup",
		label: "Bytefly startup TUI",
		description: "Use bytefly's startup header in place of Pi's startup TUI.",
		source: "app",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
	},
	{
		id: "notify.enabled",
		group: "notifications",
		label: "Desktop notifications",
		description: "Raise an OS notification when a run or job finishes, or the agent asks for input.",
		source: "bytefly",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
		config: { section: "notify", path: ["enabled"] },
	},
	{
		id: "notify.method",
		group: "notifications",
		label: "Delivery method",
		description: "How a notification is delivered; Auto picks from the terminal, then the platform.",
		source: "bytefly",
		kind: "enum",
		fallback: "auto",
		options: METHOD_OPTIONS,
		config: { section: "notify", path: ["method"] },
	},
	{
		id: "notify.title",
		group: "notifications",
		label: "Notification title",
		description: "Shown as the title of every OS notification; up to 40 characters.",
		source: "bytefly",
		kind: "text",
		fallback: "Pi",
		options: [],
		text: {
			maxLength: 40,
			validate: (raw) => (raw.trim() === "" ? "A title is required." : undefined),
		},
		config: { section: "notify", path: ["title"] },
	},
	{
		id: "doctor.proactive",
		group: "diagnostics",
		label: "Proactive health check",
		description: "Probe enabled extensions at session start and warn about a missing requirement.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "doctor", path: ["proactive"] },
	},
	{
		id: "price.currency.code",
		group: "pricing",
		label: "Currency",
		description: "CNY prices DeepSeek from its yuan rates; USD uses Pi's recorded dollar cost.",
		source: "bytefly",
		kind: "enum",
		fallback: DEFAULT_CURRENCY.code,
		options: [
			{ value: "CNY", label: "CNY (¥)" },
			{ value: "USD", label: "USD ($)" },
		],
		config: { section: "price", path: ["currency", "code"] },
	},
	{
		id: "price.currency.symbol",
		group: "pricing",
		label: "Currency symbol",
		description: "Printed before the footer's cost total; a currency change supplies its default.",
		source: "bytefly",
		kind: "text",
		fallback: "¥",
		options: [],
		text: {
			maxLength: 4,
			validate: (raw) => (raw.trim() === "" ? "A symbol is required." : undefined),
		},
		config: { section: "price", path: ["currency", "symbol"] },
	},
	{
		id: "price.currency.decimals",
		group: "pricing",
		label: "Cost decimals",
		description: "Digits shown after the decimal point in the footer's cost total.",
		source: "bytefly",
		kind: "enum",
		fallback: "2",
		json: "number",
		options: DECIMALS_OPTIONS,
		config: { section: "price", path: ["currency", "decimals"] },
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
		config: { section: "chrome", path: ["rail"] },
	},
	{
		id: "outputPad",
		group: "transcript",
		label: "Output padding",
		description: "Pi's transcript padding; bytefly's header and blocks follow it.",
		source: "app",
		kind: "enum",
		fallback: "1",
		json: "number",
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
		json: "boolean",
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

/**
 * Why a text row cannot store `raw`, or `undefined` when it can.
 *
 * The limits mirror the loaders (`notify.title` is sliced to 40, the currency
 * symbol to 4) so the editor cannot save a value the next read shortens.
 */
export function textError(row: SettingDescriptor, raw: string): string | undefined {
	const rule = row.text;
	if (!rule) return `${row.label} is not a text setting.`;
	if (raw.length > rule.maxLength) {
		return `Too long: ${raw.length} characters, the limit is ${rule.maxLength}.`;
	}
	return rule.validate?.(raw);
}

/** The display label for `raw`, or the raw value when it is a valid custom one. */
function labelFor(row: SettingDescriptor, raw: string): string {
	return row.options.find((option) => option.value === raw)?.label ?? raw;
}

/** Read an app preference and where it came from. */
function appValue(snapshot: SettingsSnapshot, row: SettingDescriptor): { value: string; origin: SettingOrigin } {
	switch (row.id) {
		case "byteflyUi": {
			const quiet = snapshot.app.quietStartup;
			return { value: quiet === true ? "true" : "false", origin: quiet === undefined ? "default" : "global" };
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

/** Whether a document states this row's leaf, so the origin is truthful. */
function statesConfig(config: SettingConfig, document: Record<string, unknown>): boolean {
	return configValueAt(document, [config.section, ...config.path]) !== undefined;
}

/** Where the effective value came from: the project file, the personal one, or nothing. */
function originFor(config: SettingConfig, snapshot: SettingsSnapshot, scope: WriteScope): SettingOrigin {
	if (scope === "project") return statesConfig(config, snapshot.project) ? "project" : "inherited";
	return statesConfig(config, snapshot.global) ? "global" : "default";
}

/** Read one leaf of a `bytefly.json` section: project over global over defaults. */
type SectionReader = (
	globalRaw: Record<string, unknown> | undefined,
	projectRaw: Record<string, unknown> | undefined,
	path: readonly string[],
) => unknown;

const SECTION_READERS: Record<ConfigSectionName, SectionReader> = {
	notify: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeNotifyConfig(projectRaw, normalizeNotifyConfig(globalRaw, DEFAULT_NOTIFY_CONFIG)), path),
	chrome: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeChromeConfig(projectRaw, normalizeChromeConfig(globalRaw, DEFAULT_CHROME_CONFIG)), path),
	doctor: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeDoctorConfig(projectRaw, normalizeDoctorConfig(globalRaw, DEFAULT_DOCTOR_CONFIG)), path),
	price: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeByteflyConfig(projectRaw, normalizeByteflyConfig(globalRaw, DEFAULT_BYTEFLY_CONFIG)), path),
};

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
	const leaf = SECTION_READERS[config.section](globalRaw, projectRaw, config.path);
	return {
		value: leaf === undefined ? row.fallback : String(leaf),
		origin: originFor(config, snapshot, scope),
	};
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
	// A text row has no cycle: the value it holds is the value it keeps.
	if (row.options.length === 0) return { value: current, label: current };
	const index = row.options.findIndex((option) => option.value === current);
	return row.options[(index + 1) % row.options.length] as SettingOption;
}

/** The JSON value a raw option stores, per the row's declared JSON type. */
export function storedValue(row: SettingDescriptor, raw: string): unknown {
	switch (row.json) {
		case "boolean":
			return raw === "true";
		case "number":
			return Number(raw);
		default:
			return raw;
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
