/**
 * Contract guard between the Settings catalogue and the config loaders it shows.
 *
 * The screen cannot import another extension's normalizer (AGENTS.md), so a row
 * states the loader's default and its own rule, and nothing at runtime proves the
 * two agree. This test does: it reads the same defaults the loaders export, and
 * fails when a loader key is neither a row nor declared JSON-only, when a
 * declaration names a key the loader does not have, or when a row's default or
 * numeric rule disagrees with the loader's clamp.
 *
 * A key the screen leaves out is declared here with a reason — a tuning number,
 * a label, or a whole section with no row — so leaving one out is a reviewed
 * decision rather than an oversight. A new section means a new entry in
 * `SECTIONS`, and adding a row means removing its declaration.
 *
 * The loaders stay the source of truth: bounds are derived by probing each
 * normalizer with an extreme value, not by exporting the limits for the test.
 *
 * The same catalogue is the source of truth for the prose that counts the
 * screen: the two entry READMEs, the extension page, the reference, and the
 * guide state how many rows it holds, and every count below is built from
 * `SETTING_ROWS`, so a fourteenth row fails here until the prose follows.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { configValueAt } from "../lib/config.ts";
import { DEFAULT_SPLIT_CONFIG, normalizeSplitConfig } from "../lib/plans/setting.ts";
import { withLeaf } from "./helpers/config.ts";
import { DEFAULT_CHROME_CONFIG, normalizeChromeConfig } from "../extensions/bytefly/chrome.ts";
import {
	DEFAULT_CONFIG as DEFAULT_DOCTOR_CONFIG,
	normalizeConfig as normalizeDoctorConfig,
} from "../extensions/bytefly/doctor/config.ts";
import { DEFAULT_BYTEFLY_CONFIG, normalizeByteflyConfig } from "../extensions/bytefly/footer/price/config.ts";
import { DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig } from "../extensions/bytefly/notify/config.ts";
import { SETTING_ROWS, textError } from "../extensions/bytefly/panel/settings.ts";
import {
	DEFAULT_CONFIG as DEFAULT_FILE_READ_CONFIG,
	normalizeConfig as normalizeFileReadConfig,
} from "../extensions/file-read/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_FILE_BROWSE_CONFIG,
	normalizeConfig as normalizeFileBrowseConfig,
} from "../extensions/file-browse/config.ts";
import { DEFAULT_GOAL_CONFIG, normalizeGoalConfig } from "../extensions/goal/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_JOB_CONFIG,
	normalizeConfig as normalizeJobConfig,
} from "../extensions/job/config.ts";
import { DEFAULT_MEMORY_CONFIG, normalizeMemoryConfig } from "../extensions/memory/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_REWIND_CONFIG,
	normalizeConfig as normalizeRewindConfig,
} from "../extensions/rewind/config.ts";
import { DEFAULT_TODO_CONFIG, normalizeTodoConfig } from "../extensions/todo/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_WATCH_CONFIG,
	normalizeConfig as normalizeWatchConfig,
} from "../extensions/watch/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_WECHAT_CONFIG,
	normalizeConfig as normalizeWechatConfig,
} from "../extensions/wechat/config.ts";
import { DEFAULT_FETCH_CONFIG } from "../extensions/web-access/fetch/config.ts";
import { DEFAULT_SEARCH_CONFIG } from "../extensions/web-access/search/config.ts";
import {
	DEFAULT_CONFIG as DEFAULT_WORKTREE_CONFIG,
	normalizeConfig as normalizeWorktreeConfig,
} from "../extensions/worktree/config.ts";

/** One `bytefly.json` section: its defaults, and a normalizer over them. */
interface SectionCase {
	section: string;
	defaults: object;
	/** Normalize one raw section over these defaults; the loader's own clamp. */
	normalize: (raw: Record<string, unknown>) => object;
	/** Keys (or whole subtrees) the screen leaves to JSON, with the reason. */
	jsonOnly: Readonly<Record<string, string>>;
}

const WEB_ACCESS_DEFAULTS = { search: DEFAULT_SEARCH_CONFIG, fetch: DEFAULT_FETCH_CONFIG };

/** Every section of the shared document, in the order the reference lists them. */
const SECTIONS: readonly SectionCase[] = [
	{
		section: "price",
		defaults: DEFAULT_BYTEFLY_CONFIG,
		normalize: (raw) => normalizeByteflyConfig(raw, DEFAULT_BYTEFLY_CONFIG),
		jsonOnly: {
			rates: "a per-model table, not one row",
			peak: "a schedule of windows, not one row",
			"currency.decimals": "written with Currency, then a bytefly.json edit",
		},
	},
	{
		// A notification's delivery is a per-machine choice, so the screen does not
		// carry it; `bytefly.json` does.
		section: "notify",
		defaults: DEFAULT_NOTIFY_CONFIG,
		normalize: (raw) => normalizeNotifyConfig(raw, DEFAULT_NOTIFY_CONFIG),
		jsonOnly: {
			title: "a cosmetic label, set once",
			method: "how a notification is delivered is set once per machine",
		},
	},
	{
		section: "doctor",
		defaults: DEFAULT_DOCTOR_CONFIG,
		normalize: (raw) => normalizeDoctorConfig(raw, DEFAULT_DOCTOR_CONFIG),
		jsonOnly: {
			skip: "a list of extension names",
			timeoutMs: "one probe's timing, tuned once on a slow machine",
		},
	},
	{
		section: "chrome",
		defaults: DEFAULT_CHROME_CONFIG,
		normalize: (raw) => normalizeChromeConfig(raw, DEFAULT_CHROME_CONFIG),
		jsonOnly: { rail: "a cosmetic glyph, set once" },
	},
	{
		section: "file-read",
		defaults: DEFAULT_FILE_READ_CONFIG,
		normalize: (raw) => normalizeFileReadConfig(raw, DEFAULT_FILE_READ_CONFIG),
		jsonOnly: {
			maxFileBytes: "an extraction limit, not a preference",
			maxChars: "an extraction limit, not a preference",
			extractTimeoutMs: "an extraction limit, not a preference",
			formats: "one switch per parser, six in all",
		},
	},
	{
		section: "file-browse",
		defaults: DEFAULT_FILE_BROWSE_CONFIG,
		normalize: (raw) => normalizeFileBrowseConfig(raw, DEFAULT_FILE_BROWSE_CONFIG),
		jsonOnly: {
			port: "a fixed port is an operator decision",
			autoOpen: "browser behaviour, not agent behaviour",
			maxFileBytes: "a rendering limit, not a preference",
			maxThumbBytes: "a rendering limit, not a preference",
			maxTextLines: "a rendering limit, not a preference",
			maxDirEntries: "a rendering limit, not a preference",
			thumbnails: "a rendering limit, not a preference",
			markdown: "a rendering limit, not a preference",
			markdownHtml: "a rendering limit, not a preference",
			maxIndexEntries: "a rendering limit, not a preference",
			gitDiff: "a rendering limit, not a preference",
			diffContext: "a rendering limit, not a preference",
			maxDiffLines: "a rendering limit, not a preference",
			live: "a browser-surface switch, not agent behaviour",
			liveIntervalMs: "a refresh interval, tuned once",
		},
	},
	{
		// Off unless a project turns it on, so the panel row starts from the loader.
		section: "plan",
		defaults: DEFAULT_SPLIT_CONFIG,
		normalize: (raw) => normalizeSplitConfig(raw, DEFAULT_SPLIT_CONFIG),
		jsonOnly: {},
	},
	{
		section: "goal",
		defaults: DEFAULT_GOAL_CONFIG,
		normalize: (raw) => normalizeGoalConfig(raw, DEFAULT_GOAL_CONFIG),
		jsonOnly: { achieved: "how a finished goal looks, set once" },
	},
	{
		section: "job",
		defaults: DEFAULT_JOB_CONFIG,
		normalize: (raw) => normalizeJobConfig(raw, DEFAULT_JOB_CONFIG),
		jsonOnly: {
			enabled: "a master switch for a tool that is on by default",
			showStatus: "chip placement, not behaviour",
			maxJobs: "a registry limit",
			maxLogLines: "a model-facing limit",
			maxLogBytes: "a registry limit",
			killGraceMs: "a shutdown timing, tuned once",
			detachedByDefault: "an exit behaviour, set once per machine",
			repaintMs: "a refresh interval, tuned once",
			sessionTtlMs: "a reaping interval, tuned once",
			registryDir: "a path override",
		},
	},
	{
		section: "watch",
		defaults: DEFAULT_WATCH_CONFIG,
		normalize: (raw) => normalizeWatchConfig(raw, DEFAULT_WATCH_CONFIG),
		jsonOnly: {
			enabled: "a master switch for a tool that is on by default",
			wakeOnMatch: "off by default; a bytefly.json edit",
			showStatus: "chip placement, not behaviour",
			maxWatchers: "a registry limit",
			maxMatches: "a registry limit",
			maxLogLines: "a model-facing limit",
			matchLines: "a model-facing limit",
			pollMs: "a poll interval, tuned once",
		},
	},
	{
		section: "memory",
		defaults: DEFAULT_MEMORY_CONFIG,
		normalize: (raw) => normalizeMemoryConfig(raw, DEFAULT_MEMORY_CONFIG),
		jsonOnly: {
			inject: "on by default; a bytefly.json edit",
			maxInjectBytes: "an injection budget, tuned once",
		},
	},
	{
		section: "rewind",
		defaults: DEFAULT_REWIND_CONFIG,
		normalize: (raw) => normalizeRewindConfig(raw, DEFAULT_REWIND_CONFIG),
		jsonOnly: {
			includeUntracked: "a snapshot detail, not a preference",
			autoPrune: "a snapshot detail, not a preference",
			showStatus: "chip placement, not behaviour",
			max: "a registry limit, tuned once",
			safetySnapshot: "on by default; a bytefly.json edit",
			watch: "a list of tool names",
			ignore: "a list of tool names",
			refNamespace: "a git ref namespace",
		},
	},
	{
		section: "todo",
		defaults: DEFAULT_TODO_CONFIG,
		normalize: (raw) => normalizeTodoConfig(raw, DEFAULT_TODO_CONFIG),
		jsonOnly: { hideWhenComplete: "widget presentation with one key" },
	},
	{
		section: "web-access",
		defaults: WEB_ACCESS_DEFAULTS,
		normalize: (raw) => raw,
		jsonOnly: {
			search: "a provider group with nested keys",
			fetch: "a fetch group with nested keys",
		},
	},
	{
		section: "wechat",
		defaults: DEFAULT_WECHAT_CONFIG,
		normalize: (raw) => normalizeWechatConfig(raw, DEFAULT_WECHAT_CONFIG),
		jsonOnly: {
			allowedPeers: "a list of WeChat ids",
			peers: "a per-peer map",
			maxTurnsPerHour: "a bridge rate limit",
			maxReplyChars: "a bridge reply limit",
			botAgent: "a protocol identifier",
			channelVersion: "a protocol version",
			cdnBaseUrl: "a protocol endpoint",
			maxMediaBytes: "a bridge transfer limit",
			maxInboundChars: "a bridge transfer limit",
			typingIndicator: "a bridge courtesy",
			remotePrompts: "a bridge routing choice",
		},
	},
	{
		section: "worktree",
		defaults: DEFAULT_WORKTREE_CONFIG,
		normalize: (raw) => normalizeWorktreeConfig(raw, DEFAULT_WORKTREE_CONFIG),
		jsonOnly: {
			baseRef: "a per-repository choice, set once",
			branchPrefix: "a per-repository label, set once",
			fetchRemote: "a per-repository choice, set once",
			pruneAfterDays: "an age in days, tuned once",
			dir: "a path inside the repository",
			fetchTimeoutMs: "a network timeout, tuned once",
			onExit: "chosen per exit at the prompt",
			include: "a list of gitignore globs",
			skipOverrides: "a list of tool names",
			guard: "a nested set of escape rules",
		},
	},
];

/** Read a default leaf, tolerating a path whose parents are not objects. */
function defaultAt(defaults: object, path: readonly string[]): unknown {
	return configValueAt(defaults as Record<string, unknown>, path);
}

/** Whether a value is a plain object, so its children can be walked. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The leaf paths a section does not cover with a row or a JSON-only declaration. */
function uncoveredLeaves(
	section: SectionCase,
	path: readonly string[],
	value: unknown,
	covered: ReadonlySet<string>,
): string[] {
	const joined = path.join(".");
	if (joined in section.jsonOnly || covered.has(joined)) return [];
	// An empty object is a leaf: nothing below it can cover it.
	if (isPlainObject(value) && Object.keys(value).length > 0) {
		return Object.entries(value).flatMap(([key, child]) => uncoveredLeaves(section, [...path, key], child, covered));
	}
	return [joined];
}

/** The leaf paths the catalogue's rows edit, per section. */
function coveredLeaves(section: string): Set<string> {
	const covered = new Set<string>();
	for (const row of SETTING_ROWS) {
		if (row.config?.section !== section) continue;
		covered.add(row.config.path.join("."));
	}
	return covered;
}

/** Whether the document states the key at `path`, whatever its value is. */
function statesPath(document: object, path: readonly string[]): boolean {
	let current: unknown = document;
	for (const key of path) {
		if (!isPlainObject(current) || !(key in current)) return false;
		current = current[key];
	}
	return true;
}

describe("the settings catalogue against the loaders", () => {
	test("covers every loader default, or declares it JSON-only", () => {
		for (const section of SECTIONS) {
			const covered = coveredLeaves(section.section);
			const uncovered = uncoveredLeaves(section, [], section.defaults, covered);
			expect({ section: section.section, uncovered }).toEqual({ section: section.section, uncovered: [] });
		}
	});

	test("declares no key the loader does not have", () => {
		for (const section of SECTIONS) {
			for (const key of Object.keys(section.jsonOnly)) {
				// A declaration is a dotted path, the same shape `uncoveredLeaves`
				// reports, so a nested leaf such as `currency.decimals` can be named
				// without declaring the whole subtree that holds a row.
				const exists = statesPath(section.defaults, key.split("."));
				expect({ section: section.section, key, exists }).toEqual({ section: section.section, key, exists: true });
			}
			for (const key of coveredLeaves(section.section)) {
				const exists = statesPath(section.defaults, key.split("."));
				expect({ section: section.section, key, exists }).toEqual({ section: section.section, key, exists: true });
			}
		}
	});

	test("states each row's default the way its loader does", () => {
		for (const row of SETTING_ROWS) {
			const config = row.config;
			if (!config) continue;
			const section = SECTIONS.find((entry) => entry.section === config.section);
			if (!section) throw new Error(`${row.id} names a section no loader declares: ${config.section}`);
			expect({ id: row.id, fallback: row.fallback }).toEqual({
				id: row.id,
				fallback: String(defaultAt(section.defaults, config.path)),
			});
		}
	});

	test("states each numeric row's bounds the way its loader clamps them", () => {
		for (const row of SETTING_ROWS) {
			const config = row.config;
			if (!config || row.kind !== "text" || row.json !== "number") continue;
			const section = SECTIONS.find((entry) => entry.section === config.section);
			if (!section) throw new Error(`${row.id} names a section no loader declares: ${config.section}`);
			const clamp = (raw: number): number =>
				Number(configValueAt(section.normalize(withLeaf({}, config.path, raw)), config.path));

			// The loader's own bounds, read by probing it rather than by exporting them.
			const low = clamp(-1_000_000);
			const high = clamp(1_000_000_000);
			expect({ id: row.id, low: textError(row, String(low)) }).toEqual({ id: row.id, low: undefined });
			expect({ id: row.id, high: textError(row, String(high)) }).toEqual({ id: row.id, high: undefined });
			expect({ id: row.id, below: textError(row, String(low - 1)) === undefined }).toEqual({
				id: row.id,
				below: false,
			});
			expect({ id: row.id, above: textError(row, String(high + 1)) === undefined }).toEqual({
				id: row.id,
				above: false,
			});
		}
	});
});

/** The repository root, so a doc is read by the path a reader follows. */
const root = join(import.meta.dir, "..");

/** One doc's text with its line wrapping flattened, so a phrase survives a reflow. */
const prose = (file: string): string => readFileSync(join(root, file), "utf-8").replace(/\s+/g, " ");

const ROW_COUNT = SETTING_ROWS.length;
const PROJECT_ROW_COUNT = SETTING_ROWS.filter((row) => row.config !== undefined).length;

const COUNT_WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
	"twenty",
];
/** The Chinese README's numerals, up to nineteen, which is past any sane screen. */
const ZH_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** A count as the English docs spell it. */
const count = (n: number): string => COUNT_WORDS[n] ?? String(n);
/** The same count in the Chinese README's numerals. */
const zhCount = (n: number): string => (n < 10 ? ZH_DIGITS[n] : `十${n % 10 === 0 ? "" : ZH_DIGITS[n % 10]}`);

/** One file and a sentence it must hold, built from the catalogue. */
const STATED: readonly { file: string; phrase: string }[] = [
	{ file: "README.md", phrase: `the ${count(ROW_COUNT)} preferences a session changes` },
	{ file: "README.zh-CN.md", phrase: `${zhCount(ROW_COUNT)}项设置` },
	{ file: "docs/extensions/bytefly.md", phrase: `a session changes: ${count(ROW_COUNT)} preferences` },
	{ file: "docs/extensions/bytefly.md", phrase: `Global · ${ROW_COUNT} settings` },
	{ file: "docs/extensions/bytefly.md", phrase: `capped at ${count(ROW_COUNT)} rows` },
	{ file: "docs/extensions/bytefly.md", phrase: `the ${count(PROJECT_ROW_COUNT)} \`bytefly.json\` rows` },
	{ file: "docs/extensions/bytefly.md", phrase: `at ${count(ROW_COUNT)} rows so the screen fits` },
	{ file: "docs/extensions/bytefly.md", phrase: `catalogue: the ${count(ROW_COUNT)} descriptors` },
	{ file: "docs/configuration.md", phrase: `${count(ROW_COUNT)} flat rows` },
	{ file: "docs/user-guide/settings-and-customization.md", phrase: `${count(ROW_COUNT)} preferences` },
];

/** The spelling each of those sentences carried before the last row landed. */
const STALE: readonly string[] = [
	`${count(ROW_COUNT - 1)} preferences`,
	`${count(ROW_COUNT - 1)} flat rows`,
	`${count(ROW_COUNT - 1)} rows`,
	`${count(ROW_COUNT - 1)} descriptors`,
	`Global · ${ROW_COUNT - 1} settings`,
	`the ${count(PROJECT_ROW_COUNT - 1)} \`bytefly.json\` rows`,
	`${zhCount(ROW_COUNT - 1)}项设置`,
];

describe("the docs count the settings screen", () => {
	test("states the catalogue's counts wherever it counts the screen", () => {
		const missing = STATED.filter((entry) => !prose(entry.file).includes(entry.phrase)).map(
			(entry) => `${entry.file} does not say "${entry.phrase}"`,
		);
		expect(missing).toEqual([]);
	});

	test("carries no count the catalogue has outgrown", () => {
		const files = [...new Set(STATED.map((entry) => entry.file))];
		const stale = files.flatMap((file) => {
			const text = prose(file);
			return STALE.filter((phrase) => text.includes(phrase)).map((phrase) => `${file} still says "${phrase}"`);
		});
		expect(stale).toEqual([]);
	});
});
