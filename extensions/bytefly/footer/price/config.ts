/**
 * The price section of the shared `bytefly.json`: schema, defaults, and loader.
 *
 * Read from the top-level `price` section of `~/.pi/agent/bytefly.json` and
 * `<cwd>/.pi/bytefly.json` (project values override global) through the shared
 * `loadConfigSection`.
 * Missing or malformed documents are ignored, and a value of the wrong type
 * falls back to the default instead of throwing.
 *
 * The built-in table is DeepSeek's published yuan pricing, with the peak
 * schedule that doubles the price during peak hours. It is the default value of
 * `rates`: `currency.code` chooses which table that is, and the peak schedule
 * applies to both. Only an unmatched model differs — `CNY` contributes no cost
 * for it, while `USD` adds Pi's recorded dollars.
 */

import { asRecord, clampInteger, clampNumber, cleanString, loadConfigSection } from "../../../../lib/config.ts";
import { parseWindow } from "./schedule.ts";
import type { ByteflyConfig, Currency, CurrencyCode, ModelRates, PeakSchedule, PeakWindow } from "./types.ts";

/** Monday to Friday, the days DeepSeek charges its peak rate. */
const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Built-in rates: DeepSeek's published prices in yuan.
 *
 * Pi's catalog prices every call in dollars at one flat rate, which is wrong
 * twice over for DeepSeek: the bill is in yuan, and peak hours cost double.
 * These are the published peak figures; `DEFAULT_PEAK` supplies the tariff. A
 * `bytefly.json` entry with the same key replaces one of these. A model with no
 * matching entry contributes no cost; USD mode uses Pi's recorded cost instead.
 *
 * Source: <https://api-docs.deepseek.com/quick_start/pricing>.
 */
export const DEFAULT_RATES: Readonly<Record<string, ModelRates>> = {
	"deepseek/deepseek-flash": { input: 2, output: 8, cacheRead: 0.04, cacheWrite: 0, offPeakMultiplier: 0.5 },
	"deepseek/deepseek-v4-pro": { input: 9, output: 27, cacheRead: 0.3, cacheWrite: 0, offPeakMultiplier: 0.5 },
};

/**
 * The same two models in DeepSeek's published dollars, per million tokens at the
 * peak rate; `offPeakMultiplier` halves them off-peak. The published table has no
 * cache-write line, so `cacheWrite` is 0 here exactly as in the yuan table.
 *
 * Source: <https://api-docs.deepseek.com/quick_start/pricing> (USD table).
 */
export const DEFAULT_RATES_USD: Readonly<Record<string, ModelRates>> = {
	"deepseek/deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0, offPeakMultiplier: 0.5 },
	"deepseek/deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0, offPeakMultiplier: 0.5 },
};

/** The built-in table for each currency: `rates` are stated in the selected one. */
export const DEFAULT_RATES_BY_CURRENCY: Readonly<Record<CurrencyCode, Readonly<Record<string, ModelRates>>>> = {
	CNY: DEFAULT_RATES,
	USD: DEFAULT_RATES_USD,
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

/** The symbol each algorithm prints. It is not configurable, so it can never disagree with the code. */
export const CURRENCY_SYMBOLS: Readonly<Record<CurrencyCode, string>> = { CNY: "¥", USD: "$" };

/** The default precision each algorithm supplies when a config sets only its code. */
export const CURRENCY_DEFAULTS: Readonly<Record<CurrencyCode, Currency>> = {
	CNY: { code: "CNY", decimals: 2 },
	USD: { code: "USD", decimals: 3 },
};

/** Yuan, the currency `DEFAULT_RATES` is stated in. */
export const DEFAULT_CURRENCY: Currency = CURRENCY_DEFAULTS.CNY;

export const DEFAULT_BYTEFLY_CONFIG: ByteflyConfig = {
	currency: DEFAULT_CURRENCY,
	rates: DEFAULT_RATES,
	peak: DEFAULT_PEAK,
};

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

/** A supported ISO code, or the base code for a missing/mistyped value. */
function currencyCode(raw: unknown, base: CurrencyCode): CurrencyCode {
	const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
	return text === "CNY" || text === "USD" ? text : base;
}

function currencyValue(raw: unknown, base: Currency): Currency {
	const value = asRecord(raw);
	if (!value) return base;
	const code = currencyCode(value.code, base.code);
	// A changed code supplies its own default precision unless this layer
	// overrides it; an unchanged code keeps the precision customized above it.
	const display = code !== base.code ? CURRENCY_DEFAULTS[code] : base;
	return {
		code,
		decimals: clampInteger(value.decimals, display.decimals, 0, MAX_DECIMALS),
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
	const currency = currencyValue(raw.currency, base.currency);
	// `rates` are stated in the selected currency, so a layer that switches the
	// code starts from that currency's table instead of reinterpreting the old
	// numbers in the new unit. A layer that sets both merges onto the new table.
	const rateBase = currency.code === base.currency.code ? base.rates : DEFAULT_RATES_BY_CURRENCY[currency.code];
	return {
		currency,
		rates: ratesValue(raw.rates, rateBase),
		peak: peakValue(raw.peak, base.peak),
	};
}

/** Effective price config for `cwd` (defaults, then the shared `price` section over global, project, and env). */
export function loadByteflyConfig(cwd: string): ByteflyConfig {
	return loadConfigSection(cwd, "price", DEFAULT_BYTEFLY_CONFIG, normalizeByteflyConfig);
}
