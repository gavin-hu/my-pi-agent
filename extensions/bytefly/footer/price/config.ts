/**
 * The `bytefly.json` price configuration: schema, defaults, and loader.
 *
 * Read from `~/.pi/agent/bytefly.json` and `<cwd>/.pi/bytefly.json` (project
 * values override global) through the shared `loadConfigFile`. Missing or
 * malformed files are ignored, and a value of the wrong type falls back to the
 * default instead of throwing.
 *
 * The built-in table is DeepSeek's published yuan pricing, with the peak
 * schedule that doubles the price during peak hours. It is the default value of
 * `rates`, so nothing here is provider-specific: another provider's currency
 * and tariff are stated in `bytefly.json`.
 */

import { asRecord, clampInteger, clampNumber, cleanString, loadConfigFile } from "../../../../lib/config.ts";
import { parseWindow } from "./schedule.ts";
import type { ByteflyConfig, Currency, ModelRates, PeakSchedule, PeakWindow } from "./types.ts";

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

/** The config file this extension reads, under the agent directory and `<cwd>/.pi`. */
export const CONFIG_FILE = "bytefly.json";

/** Effective price config for `cwd` (defaults, then the global file, then the project file). */
export function loadByteflyConfig(cwd: string): ByteflyConfig {
	return loadConfigFile(cwd, CONFIG_FILE, DEFAULT_BYTEFLY_CONFIG, normalizeByteflyConfig);
}
