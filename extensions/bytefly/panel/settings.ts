/**
 * The Settings section's catalogue and value arithmetic.
 *
 * A row is one preference: an app setting from Pi's `settings.json`, or a leaf
 * of a `bytefly.json` section. This module is pure — descriptors, a snapshot to
 * views, cycling, validation, and grouping — so the screen and the runtime share
 * one definition and the tests need no host.
 *
 * The catalogue is curated rather than exhaustive: it holds the preferences a
 * person changes, across every extension of the package, and each row states its
 * own rule so a value the screen accepts is a value the loader keeps. The rest of
 * the document stays JSON, reachable from the screen's JSON pane: a list
 * (`doctor.skip`), a table (`price.rates`), and a schedule (`price.peak`) are not
 * one row.
 *
 * Four sections have a normalizer here, so the screen shows what the footer, the
 * notifier, and the doctor keep. The six owned by other extensions are read as the
 * file states them, because importing their normalizer would be one extension
 * importing another's module; each such row declares the loader's default, and
 * `test/settings-coverage.test.ts` holds the pair together.
 */

import { configSection, configValueAt } from "../../../lib/config.ts";
import { DEFAULT_CHROME_CONFIG, isRailGlyph, normalizeChromeConfig } from "../chrome.ts";
import {
	DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG,
	normalizeConfig as normalizeDoctorConfig,
	TIMEOUT_MS_RANGE,
} from "../doctor/config.ts";
import {
	CURRENCY_DEFAULTS,
	DEFAULT_BYTEFLY_CONFIG,
	DEFAULT_CURRENCY,
	MAX_BUDGET,
	MAX_DECIMALS,
	normalizeByteflyConfig,
} from "../footer/price/config.ts";
import type { CurrencyCode } from "../footer/price/types.ts";
import { DEFAULT_NOTIFY_CONFIG, MAX_TITLE_LENGTH, normalizeNotifyConfig } from "../notify/config.ts";
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

/** One heading in the Settings list. */
interface SettingGroup {
	key: string;
	label: string;
}

/** The `bytefly.json` sections the Settings section can read and write. */
export type ConfigSectionName =
	| "notify"
	| "chrome"
	| "doctor"
	| "price"
	| "worktree"
	| "rewind"
	| "job"
	| "watch"
	| "memory"
	| "goal";

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
}

/** One rendered group: its heading and the rows under it. */
interface GroupedSettings {
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
	{ key: "worktree", label: "Worktree" },
	{ key: "snapshots", label: "Snapshots" },
	{ key: "jobs", label: "Jobs and watchers" },
	{ key: "memory", label: "Memory" },
];

const ON_OFF: readonly SettingOption[] = [
	{ value: "false", label: "Off" },
	{ value: "true", label: "On" },
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

/** Cost precision 0 through the loader's ceiling, the range `price` clamps `decimals` to. */
const DECIMALS_OPTIONS: readonly SettingOption[] = Array.from({ length: MAX_DECIMALS + 1 }, (_, value) => ({
	value: String(value),
	label: String(value),
}));

/**
 * A text rule for a whole number inside an inclusive range.
 *
 * The bounds are the loader's own (`doctor.timeoutMs` is clamped to 100-30000),
 * so an accepted value is never silently clamped on the next read. `maxLength`
 * only stops a runaway buffer; `validate` is the rule.
 */
function integerRule(min: number, max: number): TextRule {
	return {
		maxLength: String(max).length + 2,
		validate(raw) {
			const text = raw.trim();
			if (!/^\d+$/.test(text)) return `Use a whole number, ${min} to ${max}.`;
			const value = Number(text);
			if (value < min || value > max) return `Out of range: ${min} to ${max}.`;
			return undefined;
		},
	};
}

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

/** The rail's rule: the loader drops anything that is not one column. */
const RAIL_RULE: TextRule = {
	maxLength: 4,
	validate: (raw) =>
		isRailGlyph(raw) ? undefined : "Use exactly one column: a single glyph, with no spaces or control characters.",
};

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
		id: "notify.turnFinished",
		group: "notifications",
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
		group: "notifications",
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
		group: "notifications",
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
		group: "notifications",
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
			maxLength: MAX_TITLE_LENGTH,
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
		id: "doctor.timeoutMs",
		group: "diagnostics",
		label: "Probe timeout",
		description: `How long one doctor probe may take, in milliseconds; ${TIMEOUT_MS_RANGE.min} to ${TIMEOUT_MS_RANGE.max}.`,
		source: "bytefly",
		kind: "text",
		fallback: String(DEFAULT_DOCTOR_CONFIG.timeoutMs),
		json: "number",
		options: [],
		text: integerRule(TIMEOUT_MS_RANGE.min, TIMEOUT_MS_RANGE.max),
		config: { section: "doctor", path: ["timeoutMs"] },
	},
	{
		id: "price.currency.code",
		group: "pricing",
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
		// footer agree; the precision stays overridable afterwards.
		also: (raw) => {
			const currency = CURRENCY_DEFAULTS[raw as CurrencyCode];
			return currency === undefined
				? []
				: [{ section: "price", path: ["currency", "decimals"], value: currency.decimals }];
		},
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
		id: "price.budget",
		group: "pricing",
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
	{
		id: "chrome.rail",
		group: "transcript",
		label: "Rail glyph",
		description: "The single-column glyph that leads a tool result or notice body, e.g. ╎ │ ┃ ▏.",
		source: "bytefly",
		kind: "text",
		fallback: DEFAULT_CHROME_CONFIG.rail,
		options: [],
		text: RAIL_RULE,
		config: { section: "chrome", path: ["rail"] },
	},
	{
		id: "goal.achieved",
		group: "transcript",
		label: "Achieved goal",
		description: "How a completed goal renders: the dimmed rail line, or nothing.",
		source: "bytefly",
		kind: "enum",
		fallback: "hide",
		options: [
			{ value: "show", label: "Show" },
			{ value: "hide", label: "Hide" },
		],
		config: { section: "goal", path: ["achieved"] },
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
	{
		id: "worktree.baseRef",
		group: "worktree",
		label: "Base ref",
		description: "Where a new worktree branches from: the remote default branch, or the current local HEAD.",
		source: "bytefly",
		kind: "enum",
		fallback: "fresh",
		options: [
			{ value: "fresh", label: "Fresh" },
			{ value: "head", label: "Head" },
		],
		config: { section: "worktree", path: ["baseRef"] },
	},
	{
		id: "worktree.branchPrefix",
		group: "worktree",
		label: "Branch prefix",
		description: "Prepended to every branch a managed worktree creates.",
		source: "bytefly",
		kind: "text",
		fallback: "worktree-",
		options: [],
		text: {
			// The loader trims and rejects an empty prefix but sets no ceiling; this
			// only stops a runaway buffer.
			maxLength: 80,
			validate: (raw) => (raw.trim() === "" ? "A prefix is required." : undefined),
		},
		config: { section: "worktree", path: ["branchPrefix"] },
	},
	{
		id: "worktree.fetchRemote",
		group: "worktree",
		label: "Fetch remote",
		description: "Fetch the remote before branching, so a new worktree starts from its latest commit.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "worktree", path: ["fetchRemote"] },
	},
	{
		id: "worktree.pruneAfterDays",
		group: "worktree",
		label: "Prune after (days)",
		description: "Age at which `/worktree prune` removes a clean worktree nobody is using.",
		source: "bytefly",
		kind: "text",
		fallback: "7",
		json: "number",
		options: [],
		text: integerRule(0, 3650),
		config: { section: "worktree", path: ["pruneAfterDays"] },
	},
	{
		id: "rewind.autoSnapshots",
		group: "snapshots",
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
		id: "rewind.max",
		group: "snapshots",
		label: "Snapshots kept",
		description: "Snapshots kept per repository before the oldest are pruned; 0 keeps none.",
		source: "bytefly",
		kind: "text",
		fallback: "20",
		json: "number",
		options: [],
		text: integerRule(0, 1000),
		config: { section: "rewind", path: ["max"] },
	},
	{
		id: "rewind.safetySnapshot",
		group: "snapshots",
		label: "Safety snapshot",
		description: "Snapshot the current state before a restore, so a rewind can itself be undone.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "rewind", path: ["safetySnapshot"] },
	},
	{
		id: "job.wakeOnFinish",
		group: "jobs",
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
		id: "job.detachedByDefault",
		group: "jobs",
		label: "Keep jobs after exit",
		description: "Leave jobs running when the session ends, unless the job opts out.",
		source: "bytefly",
		kind: "boolean",
		fallback: "false",
		json: "boolean",
		options: ON_OFF,
		config: { section: "job", path: ["detachedByDefault"] },
	},
	{
		id: "watch.wakeOnMatch",
		group: "jobs",
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
		id: "memory.inject",
		group: "memory",
		label: "Inject notes",
		description: "Put stored memory notes in context before each run.",
		source: "bytefly",
		kind: "boolean",
		fallback: "true",
		json: "boolean",
		options: ON_OFF,
		config: { section: "memory", path: ["inject"] },
	},
];

/** The rows a scope can write: app rows are personal-file only. */
export function rowsForScope(scope: WriteScope): readonly SettingDescriptor[] {
	return scope === "global" ? SETTING_ROWS : SETTING_ROWS.filter((row) => row.source === "bytefly");
}

/**
 * Why a text row cannot store `raw`, or `undefined` when it can.
 *
 * The limits are the loaders' own (`notify.title` is sliced to `MAX_TITLE_LENGTH`,
 * the rail to one column) so the editor cannot save a value the next read shortens.
 * A row that is not text is refused here rather than in the caller, so a programmatic
 * `setValue` gets the same reason the screen would show.
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
			return { value: quiet === true ? "true" : row.fallback, origin: quiet === undefined ? "default" : "global" };
		}
		case "outputPad":
			return {
				value: snapshot.app.outputPad === 0 ? "0" : row.fallback,
				origin: snapshot.app.outputPad === undefined ? "default" : "global",
			};
		case "showHardwareCursor":
			return {
				value: snapshot.app.showHardwareCursor === true ? "true" : row.fallback,
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

/**
 * The four sections bytefly owns, each read through its own normalizer so the
 * screen shows the value the loader keeps.
 */
const SECTION_READERS: Partial<Record<ConfigSectionName, SectionReader>> = {
	notify: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeNotifyConfig(projectRaw, normalizeNotifyConfig(globalRaw, DEFAULT_NOTIFY_CONFIG)), path),
	chrome: (globalRaw, projectRaw, path) =>
		configValueAt(normalizeChromeConfig(projectRaw, normalizeChromeConfig(globalRaw, DEFAULT_CHROME_CONFIG)), path),
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
