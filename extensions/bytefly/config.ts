/**
 * Tuning for the two-line status bar, and the user's price configuration.
 *
 * `CONFIG` is the bar's own content and layout — weights live on the segments
 * themselves (see `render/segments.ts`). Everything below it is
 * `bytefly.json`: read from `~/.pi/agent/bytefly.json` and
 * `<cwd>/.pi/bytefly.json` (project values override global). Missing or
 * malformed files are ignored, and a value of the wrong type falls back to the
 * default instead of throwing.
 *
 * The extension was called `chrome` before it was released as `bytefly`. A
 * `chrome.json` left by that name is moved to `bytefly.json` on load, and is
 * still read in place when the directory is not writable, so a saved price
 * configuration survives the rename.
 */

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { clampInteger, clampNumber, cleanString, readJson } from "../../lib/config.ts";
import { GLYPHS, SEPARATORS, STATUS_KEYS } from "../../lib/ui.ts";
import { parseWindow } from "./price/schedule.ts";
import { asRecord } from "./record.ts";
import type { Currency, ModelRates, PeakSchedule, PeakWindow, ByteflyConfig } from "./types.ts";

export const CONFIG = {
	/** Context percentage thresholds. */
	thresholds: { warn: 70, danger: 90 },
	/** Gauge glyphs, and the block counts the gauge steps down through. */
	gauge: { full: GLYPHS.gaugeFull, empty: GLYPHS.gaugeEmpty, widths: [10, 5, 3, 0] as const },
	/** Separators printed before grouped and other segments. */
	separators: { group: SEPARATORS.group, item: SEPARATORS.item },
	icons: { branch: GLYPHS.branch, detached: GLYPHS.detached, worktree: GLYPHS.worktree, serve: GLYPHS.serve },
	/** Status key the worktree extension uses; routed to line 1's right zone. */
	worktreeStatusKey: STATUS_KEYS.worktree,
	/** Status key the file-browser extension uses; routed to line 1's right zone. */
	serveStatusKey: STATUS_KEYS.serve,
	/** Status key whose ` · detail` suffix (the plan file name) is dropped. */
	planStatusKey: STATUS_KEYS.planMode,
	/** Status key treated as an alert: the one that sorts to the front of the slot. */
	jobsFailureStatusKey: STATUS_KEYS.jobsFailure,
	labels: { noModel: "no model", detached: "detached" },
	/** Minimum gap kept between the left and right zones. */
	minGap: 2,
	/** Worktree label length before the compact form truncates it. */
	worktreeLabelMax: 14,
	/** Session-name length before the compact form truncates it. */
	sessionLabelMax: 14,
} as const;

// --- Price configuration (bytefly.json) ----------------------------------

/** Monday to Friday, the days DeepSeek charges its peak rate. */
const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Built-in rates: DeepSeek's published prices in yuan.
 *
 * Pi's catalog prices every call in dollars at one flat rate, which is wrong
 * twice over for DeepSeek: the bill is in yuan, and peak hours cost double.
 * These are the published peak figures; `DEFAULT_PEAK` supplies the tariff. A
 * `bytefly.json` entry with the same key replaces one of these, and every
 * other provider still falls back to Pi's recorded cost.
 *
 * Source: <https://api-docs.deepseek.com/quick_start/pricing>.
 */
export const DEFAULT_RATES: Readonly<Record<string, ModelRates>> = {
	"deepseek/deepseek-flash": { input: 2, output: 8, cacheRead: 0.04, cacheWrite: 0, offPeakMultiplier: 0.5 },
	"deepseek/deepseek-v4-pro": { input: 9, output: 27, cacheRead: 0.3, cacheWrite: 0, offPeakMultiplier: 0.5 },
};

/**
 * DeepSeek's peak hours, in the zone the provider states them in: 01:00-04:00
 * and 06:00-10:00 UTC on weekdays, which is 09:00-12:00 and 14:00-18:00 in
 * Shanghai. Every other hour, and the whole weekend, is off-peak. Chinese
 * public holidays are off-peak too and cannot be expressed here, so they are
 * charged at the peak rate.
 */
export const DEFAULT_PEAK: PeakSchedule = {
	timezone: "Asia/Shanghai",
	windows: [
		{ days: WEEKDAYS, from: 9 * 60, to: 12 * 60 },
		{ days: WEEKDAYS, from: 14 * 60, to: 18 * 60 },
	],
};

/** Rendered-currency default: yuan, the currency `DEFAULT_RATES` is stated in. */
export const DEFAULT_CURRENCY: Currency = { symbol: "¥", decimals: 2 };

export const DEFAULT_BYTEFLY_CONFIG: ByteflyConfig = {
	currency: DEFAULT_CURRENCY,
	fallbackToRecordedCost: true,
	rates: DEFAULT_RATES,
	peak: DEFAULT_PEAK,
};

const MAX_SYMBOL_LENGTH = 4;
const MAX_DECIMALS = 4;
const MAX_RATE = 1_000_000;
const MAX_RATE_KEYS = 200;
const MAX_WINDOWS = 16;

/** Whether `Intl` accepts the zone; a mistyped zone is a config typo, not a crash. */
function acceptsTimeZone(timezone: string): boolean {
	try {
		const probe = new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return probe.resolvedOptions().timeZone !== "";
	} catch {
		return false;
	}
}

function currencyValue(raw: unknown, base: Currency): Currency {
	const value = asRecord(raw);
	if (!value) return base;
	return {
		symbol: cleanString(value.symbol, base.symbol).slice(0, MAX_SYMBOL_LENGTH),
		decimals: clampInteger(value.decimals, base.decimals, 0, MAX_DECIMALS),
	};
}

/** Rates merge key by key, so a project file can override one model without
 *  restating the rest; a key present in both layers is replaced, not merged. */
function ratesValue(raw: unknown, base: Readonly<Record<string, ModelRates>>): Readonly<Record<string, ModelRates>> {
	const value = asRecord(raw);
	if (!value) return base;
	const merged: Record<string, ModelRates> = { ...base };
	for (const [key, entry] of Object.entries(value)) {
		if (!(key in merged) && Object.keys(merged).length >= MAX_RATE_KEYS) break;
		const rate = modelRatesValue(entry);
		if (rate) merged[key] = rate;
	}
	return merged;
}

/** Five guarded numbers; an object stating none of them is not a rate. */
function modelRatesValue(raw: unknown): ModelRates | null {
	const value = asRecord(raw);
	if (!value) return null;
	const fields = ["input", "output", "cacheRead", "cacheWrite", "offPeakMultiplier"] as const;
	if (!fields.some((field) => field in value)) return null;
	return {
		input: clampNumber(value.input, 0, 0, MAX_RATE),
		output: clampNumber(value.output, 0, 0, MAX_RATE),
		cacheRead: clampNumber(value.cacheRead, 0, 0, MAX_RATE),
		cacheWrite: clampNumber(value.cacheWrite, 0, 0, MAX_RATE),
		offPeakMultiplier: clampNumber(value.offPeakMultiplier, 1, 0, 1),
	};
}

function peakValue(raw: unknown, base: PeakSchedule): PeakSchedule {
	const value = asRecord(raw);
	if (!value) return base;
	const timezone = cleanString(value.timezone, base.timezone);
	// An unknown zone makes every window meaningless, so the whole schedule is
	// dropped: pricing stays at peak rather than at a guessed local time.
	if (!acceptsTimeZone(timezone)) return { timezone: base.timezone, windows: [] };
	if (value.windows === undefined) return { timezone, windows: base.windows };
	// A wrong type is a config typo, so it keeps the windows rather than
	// flattening the tariff to a single rate. An empty array still clears them.
	if (!Array.isArray(value.windows)) return { timezone, windows: base.windows };
	const windows: PeakWindow[] = [];
	for (const entry of value.windows.slice(0, MAX_WINDOWS)) {
		const window = parseWindow(entry);
		if (window) windows.push(window);
	}
	return { timezone, windows };
}

/** Validate a raw config object over `base`. Total: never throws, never guesses. */
export function normalizeByteflyConfig(raw: Record<string, unknown> | undefined, base: ByteflyConfig): ByteflyConfig {
	if (!raw) return base;
	return {
		currency: currencyValue(raw.currency, base.currency),
		fallbackToRecordedCost:
			typeof raw.fallbackToRecordedCost === "boolean" ? raw.fallbackToRecordedCost : base.fallbackToRecordedCost,
		rates: ratesValue(raw.rates, base.rates),
		peak: peakValue(raw.peak, base.peak),
	};
}

// --- Legacy config migration ---------------------------------------------

/** The config file this extension reads. */
export const CONFIG_FILE = "bytefly.json";
/** The name the config file had as `chrome`. */
export const LEGACY_CONFIG_FILE = "chrome.json";

/**
 * Move a legacy `chrome.json` to `bytefly.json` in one directory, when only the
 * legacy file exists. Best-effort: an unwritable directory keeps the legacy
 * file, which {@link scopedConfig} then reads in place.
 */
function migrateLegacyConfig(dir: string): void {
	const legacy = join(dir, LEGACY_CONFIG_FILE);
	if (!existsSync(legacy) || existsSync(join(dir, CONFIG_FILE))) return;
	try {
		renameSync(legacy, join(dir, CONFIG_FILE));
	} catch {
		// Leave the legacy file; the fallback read below still finds it.
	}
}

/** Raw config for one scope, preferring `bytefly.json` over a legacy `chrome.json`. */
function scopedConfig(dir: string): Record<string, unknown> | undefined {
	return readJson(join(dir, CONFIG_FILE)) ?? readJson(join(dir, LEGACY_CONFIG_FILE));
}

/** Effective price config for `cwd` (global file, then project file, over defaults). */
export function loadByteflyConfig(cwd: string): ByteflyConfig {
	const agentDir = getAgentDir();
	const projectDir = join(cwd, CONFIG_DIR_NAME);
	migrateLegacyConfig(agentDir);
	migrateLegacyConfig(projectDir);
	let config = DEFAULT_BYTEFLY_CONFIG;
	config = normalizeByteflyConfig(scopedConfig(agentDir), config);
	config = normalizeByteflyConfig(scopedConfig(projectDir), config);
	return config;
}
