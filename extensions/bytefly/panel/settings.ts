/**
 * The Settings section's catalogue and value arithmetic.
 *
 * A row is one preference: an app setting from Pi's `settings.json`, or a leaf
 * of a `bytefly.json` section. This module is pure — descriptors, a snapshot to
 * views, cycling, and validation — so the screen, the text listing, and the
 * runtime share one definition and the tests need no host.
 *
 * The catalogue is the shortlist a session changes, not the whole document: every
 * row is one a workflow differs on, and each states its own rule so a value the
 * screen accepts is a value the loader keeps. The catalogue order is the screen's
 * order, and it is capped so the section fits a 24-row terminal (`settings.test.ts`
 * holds the ceiling); a new row has to displace one. Everything else stays
 * `bytefly.json` — a list (`doctor.skip`), a table (`price.rates`), a schedule
 * (`price.peak`), and the tuning numbers and labels this screen deliberately does
 * not carry — documented in `docs/configuration.md` and reachable from the JSON
 * pane of any row whose section is still on the list.
 *
 * Three sections have a normalizer here, so the screen shows what the notifier,
 * the doctor, and the footer keep. The three owned by other extensions (`rewind`,
 * `job`, `watch`) are read as the file states them, because importing their
 * normalizer would be one extension importing another's module; each such row
 * declares the loader's default, and `test/settings-coverage.test.ts` holds the
 * pair together.
 */

import { configSection, configValueAt } from "../../../lib/config.ts";
import { DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG, normalizeConfig as normalizeDoctorConfig } from "../doctor/config.ts";
import {
	CURRENCY_DEFAULTS,
	DEFAULT_BYTEFLY_CONFIG,
	DEFAULT_CURRENCY,
	MAX_BUDGET,
	normalizeByteflyConfig,
} from "../footer/price/config.ts";
import type { CurrencyCode } from "../footer/price/types.ts";
import { DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig } from "../notify/config.ts";
import type { Settings, WriteScope } from "../picker/types.ts";

/** Where a preference is stored. */
type SettingSource = "app" | "bytefly";

/** The row control a preference uses. */
type SettingKind = "boolean" | "enum" | "text";

/** Where the effective value came from. */
type SettingOrigin = "default" | "global" | "project" | "inherited";

/** One curated value a row can take. */
interface SettingOption {
	value: string;
	label: string;
}

/** What a text row accepts, checked before a write so the file cannot hold less. */
interface TextRule {
	/** Longest accepted value, in the units the loader slices with. */
	maxLength: number;
	/** Why `raw` cannot be stored, or `undefined` when it can. */
	validate?: (raw: string) => string | undefined;
}

/** The `bytefly.json` sections a row still reaches. */
export type ConfigSectionName = "notify" | "doctor" | "price" | "rewind" | "job" | "watch";

/** Where a `bytefly.json` row lives: a section, and the path to its leaf. */
interface SettingConfig {
	section: ConfigSectionName;
	path: readonly string[];
}

/** One `bytefly.json` leaf a row writes alongside its own. */
interface SettingLeaf {
	section: ConfigSectionName;
	path: readonly string[];
	value: unknown;
}

/** The static definition of one preference. */
export interface SettingDescriptor {
	/** Stable identity, also the focus key. */
	id: string;
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
	/**
	 * Extra leaves written with this row's own, for a value that implies another.
	 * Kept on the row so the writer stays generic and the rule is stated once.
	 */
	also?: (raw: string) => readonly SettingLeaf[];
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
	/** Theme names the Theme row offers, narrowed to this package's palettes by the caller. */
	themes: readonly string[];
}

const ON_OFF: readonly SettingOption[] = [
	{ value: "false", label: "Off" },
	{ value: "true", label: "On" },
];

/** The notify section's delivery methods, labeled by the surface each reaches. */

/**
 * A text rule for a money amount inside an inclusive range: a whole number or a
 * decimal with up to four places, matching the loader's clamp for `price.budget`.
 * `0` is a legitimate value (the guardrail is off), so it is not rejected.
 */
function amountRule(min: number, max: number): TextRule {
	return {
		maxLength: 16,
		validate(raw) {
			const text = raw.trim();
			if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return `Use an amount like 5 or 2.50, ${min} to ${max}.`;
			const value = Number(text);
			if (!Number.isFinite(value) || value < min || value > max) return `Out of range: ${min} to ${max}.`;
			return undefined;
		},
	};
}

/**
 * The catalogue, in screen order.
 *
 * Global scope lists all thirteen; Project lists the eleven `bytefly.json` rows,
 * because Pi's setters write the personal `settings.json` only. The list is
 * capped so the screen keeps fitting a 24-row terminal.
 */
export const SETTING_ROWS: readonly SettingDescriptor[] = [
	{
		id: "byteflyUi",
		label: "Bytefly startup TUI",
		description: "Use bytefly's startup header in place of Pi's startup TUI.",
		source: "app",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
	},
	{
		id: "theme",
		label: "Theme",
		description:
			"Pi's color theme, chosen from the palettes this package ships; `system` follows the terminal's colors. Takes effect after reload.",
		source: "app",
		kind: "enum",
		fallback: "system",
		// The host supplies this package's theme names in the snapshot; the static list stays empty.
		options: [],
	},
	{
		id: "notify.enabled",
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
		id: "notify.turnFinished",
		label: "Turn finished",
		description: "Announce it when a full agent run settles.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "notify", path: ["turnFinished"] },
	},
	{
		id: "notify.needsInput",
		label: "Needs input",
		description: "Announce it when the agent opens a prompt and waits for an answer.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "notify", path: ["needsInput"] },
	},
	{
		id: "notify.jobFinished",
		label: "Job finished",
		description: "Announce it when a background job or watcher settles.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "notify", path: ["jobFinished"] },
	},
	{
		id: "notify.matchFound",
		label: "Watcher matched",
		description: "Announce it when a `watch` whose `wake` is on matches while the agent is idle.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "notify", path: ["matchFound"] },
	},
	{
		id: "job.wakeOnFinish",
		label: "Wake when a job finishes",
		description: "Start one agent turn when any background job finishes.",
		source: "bytefly",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
		config: { section: "job", path: ["wakeOnFinish"] },
	},
	{
		id: "watch.wakeOnMatch",
		label: "Wake on a match",
		description: "Start one agent turn when a watcher matches while the agent is idle.",
		source: "bytefly",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
		config: { section: "watch", path: ["wakeOnMatch"] },
	},
	{
		id: "rewind.autoSnapshots",
		label: "Automatic snapshots",
		description: "Take one rewind snapshot per prompt, before the first mutating tool call.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "rewind", path: ["autoSnapshots"] },
	},
	{
		id: "doctor.proactive",
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
		label: "Currency",
		description:
			"CNY prices DeepSeek from its yuan rates; USD from its published dollars, falling back to Pi's recorded cost.",
		source: "bytefly",
		kind: "enum",
		fallback: DEFAULT_CURRENCY.code,
		options: [
			{ value: "CNY", label: "CNY (¥)" },
			{ value: "USD", label: "USD ($)" },
		],
		config: { section: "price", path: ["currency", "code"] },
		// Choosing a currency also sets its default precision, so the screen and the
		// footer agree; the precision stays overridable in `bytefly.json` afterwards.
		also: (raw) => {
			const currency = CURRENCY_DEFAULTS[raw as CurrencyCode];
			return currency === undefined
				? []
				: [{ section: "price", path: ["currency", "decimals"], value: currency.decimals }];
		},
	},
	{
		id: "price.budget",
		label: "Session budget",
		description: "Warn once when the session's cost reaches this amount; 0 is off. It never stops a turn.",
		source: "bytefly",
		kind: "text",
		fallback: "0",
		json: "number",
		options: [],
		text: amountRule(0, MAX_BUDGET),
		config: { section: "price", path: ["budget"] },
	},
];

/** The one refusal for a Project write while the project is untrusted. */
export const UNTRUSTED_SETTINGS_NOTE = "Project is not trusted; settings can only be changed in Global scope.";

/** The rows a scope can write: app rows are personal-file only. */
export function rowsForScope(scope: WriteScope): readonly SettingDescriptor[] {
	return scope === "global" ? SETTING_ROWS : SETTING_ROWS.filter((row) => row.source === "bytefly");
}

/**
 * Why a text row cannot store `raw`, or `undefined` when it can.
 *
 * The limits are the loaders' own (the budget is clamped to `MAX_BUDGET`) so the
 * editor cannot save a value the next read shortens. A row that is not text is
 * refused here rather than in the caller, so a programmatic `setValue` gets the
 * same reason the screen would show.
 */
export function textError(row: SettingDescriptor, raw: string): string | undefined {
	const rule = row.text;
	if (!rule) return `${row.label} is not a text setting.`;
	if (raw.length > rule.maxLength) {
		return `Too long: ${raw.length} characters, the limit is ${rule.maxLength}.`;
	}
	return rule.validate?.(raw);
}

/** The Theme row's values: `system` first, then the names the caller offers. */
function themeOptions(themes: readonly string[]): readonly SettingOption[] {
	const names = ["system", ...new Set(themes.filter((name) => name !== "" && name !== "system"))];
	return names.map((name) => ({ value: name, label: name }));
}

/** The display label for `raw`, or the raw value when it is a valid custom one. */
function labelFor(row: SettingDescriptor, raw: string): string {
	const option = row.options.find((entry) => entry.value === raw);
	if (option) return option.label;
	// A stored light/dark pair is Pi's automatic mode, not a missing theme.
	return row.id === "theme" && raw.includes("/") ? `${raw} (automatic)` : raw;
}

/** Read an app preference and where it came from. */
function appValue(snapshot: SettingsSnapshot, row: SettingDescriptor): { value: string; origin: SettingOrigin } {
	switch (row.id) {
		case "byteflyUi": {
			const quiet = snapshot.app.quietStartup;
			return { value: quiet === true ? "true" : row.fallback, origin: quiet === undefined ? "default" : "global" };
		}
		case "theme": {
			const theme = snapshot.app.theme;
			const set = typeof theme === "string" && theme !== "";
			return { value: set ? theme : row.fallback, origin: set ? "global" : "default" };
		}
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
	if (scope === "project") {
		if (statesConfig(config, snapshot.project)) return "project";
		if (statesConfig(config, snapshot.global)) return "inherited";
		return "default";
	}
	return statesConfig(config, snapshot.global) ? "global" : "default";
}

/** Read one leaf of a `bytefly.json` section: project over global over defaults. */
type SectionReader = (
	globalRaw: Record<string, unknown> | undefined,
	projectRaw: Record<string, unknown> | undefined,
	path: readonly string[],
) => unknown;

/** The sections bytefly owns, each read through its own normalizer so the screen shows what the loader keeps. */
const SECTION_READERS: Partial<Record<ConfigSectionName, SectionReader>> = {
	notify: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeNotifyConfig(projectRaw, normalizeNotifyConfig(globalRaw, DEFAULT_NOTIFY_CONFIG)), path),
	doctor: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeDoctorConfig(projectRaw, normalizeDoctorConfig(globalRaw, DEFAULT_DOCTOR_CONFIG)), path),
	price: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeByteflyConfig(projectRaw, normalizeByteflyConfig(globalRaw, DEFAULT_BYTEFLY_CONFIG)), path),
};

/**
 * Read a leaf whose owning extension owns the normalizer.
 *
 * A section without a reader here belongs to another extension, and importing its
 * normalizer would be one extension importing another's module. So the row states
 * the loader's default in `fallback`, `test/settings-coverage.test.ts` holds the
 * two together, and the visible cost is that a hand-edited value outside the
 * loader's clamp shows as written until it is reset.
 */
function rawLeaf(snapshot: SettingsSnapshot, config: SettingConfig, scope: WriteScope): unknown {
	const projectLeaf =
		scope === "project" ? configValueAt(configSection(snapshot.project, config.section), config.path) : undefined;
	return projectLeaf ?? configValueAt(configSection(snapshot.global, config.section), config.path);
}

/** Read a `bytefly.json` preference: normalized where bytefly owns the section. */
function byteflyValue(
	snapshot: SettingsSnapshot,
	row: SettingDescriptor,
	scope: WriteScope,
): { value: string; origin: SettingOrigin } {
	const config = row.config;
	if (!config) throw new Error(`Setting ${row.id} has no config section`);
	const globalRaw = configSection(snapshot.global, config.section);
	const projectRaw = scope === "project" ? configSection(snapshot.project, config.section) : undefined;
	const reader = SECTION_READERS[config.section];
	const leaf = reader ? reader(globalRaw, projectRaw, config.path) : rawLeaf(snapshot, config, scope);
	return {
		// A normalizer is total, so its fallback only covers a future row whose
		// normalizer has no default yet; a raw read needs it when neither document
		// states the key.
		value: leaf === undefined ? row.fallback : String(leaf),
		origin: originFor(config, snapshot, scope),
	};
}

/** Build the rows for `scope` from a snapshot. */
export function settingViews(snapshot: SettingsSnapshot, scope: WriteScope): SettingView[] {
	return rowsForScope(scope).map((row) => {
		const options = row.id === "theme" ? themeOptions(snapshot.themes) : row.options;
		const { value, origin } = row.source === "app" ? appValue(snapshot, row) : byteflyValue(snapshot, row, scope);
		const view = { ...row, options, value };
		return { ...view, valueLabel: labelFor(view, value), origin };
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
