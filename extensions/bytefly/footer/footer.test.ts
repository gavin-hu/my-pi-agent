/**
 * The bytefly footer capability: price configuration and lookup, peak
 * scheduling, pricing, usage collection, the child-run ledger, the snapshot
 * reader, the two-line bar's segments and layout, the budget guardrail, and the
 * install/restore lifecycle.
 *
 * The bar's tests assert fields, ordering, roles, and width bounds; the shared
 * gauge, chip, and frame contracts live in `lib/tui/`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SUBAGENT_FINISHED_CHANNEL } from "../../../lib/events.ts";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import { zeroUsage } from "../../../lib/usage.ts";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { emit, fakeTheme, makeFakePi, makeRecordingTheme } from "../../../test/helpers/fakes.ts";
import { fakeFooterCtx, fullSnapshot, renderFooter, usageOf } from "../../../test/helpers/fixtures/bytefly.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { budgetBody, budgetNotice, budgetState } from "./budget.ts";
import { usageRecords } from "./collect/entries.ts";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { CONFIG } from "./config.ts";
import { createDelegationLedger, MAX_DELEGATION_RECORDS } from "./delegation.ts";
import {
	CURRENCY_DEFAULTS,
	DEFAULT_BYTEFLY_CONFIG,
	DEFAULT_RATES,
	DEFAULT_RATES_USD,
	loadByteflyConfig,
	normalizeByteflyConfig,
	PRICE_VERIFIED_AT,
} from "./price/config.ts";
import { createPricer } from "./price/price.ts";
import { createRateLookup } from "./price/rates.ts";
import { isPeak, parseWindow, peakFormatter } from "./price/schedule.ts";
import type { ByteflyConfig, ModelRates } from "./price/types.ts";
import { registerFooter } from "./register.ts";
import { createFooter } from "./render/footer.ts";
import { contextRole, formatCost, formatCwd, formatPercent, thinkingColor, truncateLabel } from "./render/format.ts";
import { renderLine } from "./render/layout.ts";
import { buildLines } from "./render/lines.ts";
import {
	alertSegment,
	branchSegment,
	browseSegment,
	cacheSegment,
	contextSegment,
	costSegment,
	delegationSegment,
	modelSegment,
	modesSegment,
	pwdSegment,
	sessionSegment,
	thinkingSegment,
	tokensSegment,
	windowSegment,
	worktreeSegment,
} from "./render/segments.ts";
import { compactStatus, dropStatusDetail } from "./render/status.ts";
import { NAMED_MODELS, unpricedBody, unpricedNotice } from "./unpriced.ts";
import type { UsageRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function tempCwd(prefix: string): string {
	return temps.track(tempDir(prefix));
}

function writeConfig(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify(value));
}

function writeProjectConfig(cwd: string, price: Record<string, unknown>): void {
	writeConfig(join(cwd, ".pi"), "bytefly.json", { price });
}

const config = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
	...DEFAULT_BYTEFLY_CONFIG,
	...overrides,
});

const usdConfig = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
	...normalizeByteflyConfig({ currency: { code: "USD" } }, DEFAULT_BYTEFLY_CONFIG),
	...overrides,
});

const rate = { input: 2, output: 8, cacheRead: 0.04, cacheWrite: 0, offPeakMultiplier: 0.5 };

/** A DeepSeek flash config: ¥2 / ¥8 per million, half price off-peak. */
const deepseek = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig =>
	config({
		currency: { code: "CNY", decimals: 2 },
		rates: { "deepseek/deepseek-flash": rate },
		peak: { timezone: "Asia/Shanghai", windows: [{ days: [1, 2, 3, 4, 5], from: 540, to: 720 }] },
		...overrides,
	});

/** 2026-01-05 is a Monday; 03:00 UTC is 11:00 in Asia/Shanghai. */
const MONDAY_PEAK = Date.UTC(2026, 0, 5, 3);
/** 13:00 UTC is 21:00 in Asia/Shanghai, outside every window. */
const MONDAY_OFF_PEAK = Date.UTC(2026, 0, 5, 13);

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
	provider: "deepseek",
	model: "deepseek-flash",
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	recordedCost: 0,
	at: null,
	isAssistant: false,
	...overrides,
});

describe("price config", () => {
	test("returns the base for a missing object", () => {
		expect(normalizeByteflyConfig(undefined, DEFAULT_BYTEFLY_CONFIG)).toEqual(DEFAULT_BYTEFLY_CONFIG);
	});

	test("yields the defaults for garbage instead of throwing", () => {
		expect(normalizeByteflyConfig({ currency: "¥", rates: [], peak: 7 }, DEFAULT_BYTEFLY_CONFIG)).toEqual(
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(
			normalizeByteflyConfig(
				{ currency: { decimals: "x" }, rates: { "a/b": "cheap" }, peak: { timezone: [], windows: "all" } },
				DEFAULT_BYTEFLY_CONFIG,
			),
		).toEqual(DEFAULT_BYTEFLY_CONFIG);
	});

	test("ignores unknown keys", () => {
		expect(normalizeByteflyConfig({ bar: { width: 12 } }, DEFAULT_BYTEFLY_CONFIG)).toEqual(DEFAULT_BYTEFLY_CONFIG);
	});

	test("reads and clamps the currency precision", () => {
		expect(normalizeByteflyConfig({ currency: { decimals: 9 } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual({
			code: "CNY",
			decimals: 4,
		});
		expect(normalizeByteflyConfig({ currency: { decimals: -1 } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual({
			code: "CNY",
			decimals: 0,
		});
	});

	test("switches the algorithm with the currency code and supplies its defaults", () => {
		expect(normalizeByteflyConfig({ currency: { code: "usd" } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual({
			code: "USD",
			decimals: 3,
		});
		expect(normalizeByteflyConfig({ currency: { code: "USD", decimals: 2 } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual(
			{ code: "USD", decimals: 2 },
		);
		expect(normalizeByteflyConfig({ currency: { code: "EUR" } }, DEFAULT_BYTEFLY_CONFIG).currency.code).toBe("CNY");
	});

	test("a project currency code supplies the new currency's precision", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeProjectConfig(cwd, { currency: { code: "USD" } });
		await withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", { price: { currency: { decimals: 0 } } });
			expect(loadByteflyConfig(cwd).currency).toEqual({ code: "USD", decimals: 3 });
		}, "bytefly-price-agent-");
	});

	test("keeps the fractional rates and clamps the bounds", () => {
		const normalized = normalizeByteflyConfig(
			{ rates: { "a/b": { input: 0.006, output: -5, offPeakMultiplier: 2 } } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(normalized.rates["a/b"]).toEqual({
			input: 0.006,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			offPeakMultiplier: 1,
		});
	});

	test("drops a rate entry that states no rate at all", () => {
		expect(normalizeByteflyConfig({ rates: { "a/b": {}, "c/d": 5 } }, DEFAULT_BYTEFLY_CONFIG).rates).toEqual(
			DEFAULT_RATES,
		);
	});

	test("replaces a built-in rate without disturbing the others", () => {
		const normalized = normalizeByteflyConfig(
			{ rates: { "deepseek/deepseek-flash": { input: 1 } } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(normalized.rates["deepseek/deepseek-flash"]?.input).toBe(1);
		expect(normalized.rates["deepseek/deepseek-flash"]?.output).toBe(0);
		expect(normalized.rates["deepseek/deepseek-v4-pro"]).toEqual(DEFAULT_RATES["deepseek/deepseek-v4-pro"]);
	});

	test("drops a schedule stated in an unknown zone", () => {
		const normalized = normalizeByteflyConfig(
			{ peak: { timezone: "Mars/Olympus", windows: [{ from: "09:00", to: "12:00" }] } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(normalized.peak).toEqual({ timezone: "Asia/Shanghai", windows: [] });
	});

	test("keeps only the well-formed windows", () => {
		const normalized = normalizeByteflyConfig(
			{
				peak: {
					timezone: "Asia/Shanghai",
					windows: [{ from: "09:00", to: "12:00" }, { from: "9:5", to: "12:00" }, "nope"],
				},
			},
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(normalized.peak.timezone).toBe("Asia/Shanghai");
		expect(normalized.peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
	});

	test("prices DeepSeek in yuan with no file at all", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		await withAgentDir(() => {
			const loaded = loadByteflyConfig(cwd);
			expect(loaded.currency).toEqual({ code: "CNY", decimals: 2 });
			expect(loaded.rates["deepseek/deepseek-flash"]).toEqual(DEFAULT_RATES["deepseek/deepseek-flash"]);
			expect(loaded.peak.timezone).toBe("Asia/Shanghai");
			expect(loaded.peak.windows).toHaveLength(2);
		}, "bytefly-price-agent-");
	});

	test("layers the global file, then the project file over it", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeProjectConfig(cwd, { currency: {} });
		await withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", { price: { currency: { decimals: 3 } } });
			expect(loadByteflyConfig(cwd).currency).toEqual({ code: "CNY", decimals: 3 });
		}, "bytefly-price-agent-");
	});

	test("merges rates key by key, the project file replacing a shared key", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeProjectConfig(cwd, { rates: { shared: { input: 1 }, "only-project": { input: 3 } } });
		await withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { rates: { shared: { input: 2, output: 5 }, "only-global": { input: 7 } } },
			});
			const loaded = loadByteflyConfig(cwd);
			expect(loaded.rates.shared).toEqual({
				input: 1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				offPeakMultiplier: 1,
			});
			expect(loaded.rates["only-global"]?.input).toBe(7);
			expect(loaded.rates["only-project"]?.input).toBe(3);
		}, "bytefly-price-agent-");
	});

	test("keeps the global windows when a project file only overrides the zone", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeProjectConfig(cwd, { peak: { timezone: "UTC" } });
		await withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { peak: { timezone: "Asia/Shanghai", windows: [{ from: "09:00", to: "12:00" }] } },
			});
			const loaded = loadByteflyConfig(cwd);
			expect(loaded.peak.timezone).toBe("UTC");
			expect(loaded.peak.windows).toHaveLength(1);
		}, "bytefly-price-agent-");
	});

	test("replaces the windows when a project file states them", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeProjectConfig(cwd, { peak: { windows: [{ from: "09:00", to: "12:00" }] } });
		await withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { peak: { timezone: "UTC", windows: [{ from: "10:00", to: "11:00" }] } },
			});
			expect(loadByteflyConfig(cwd).peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
		}, "bytefly-price-agent-");
	});

	test("ignores a malformed file", async () => {
		const cwd = tempCwd("bytefly-price-cwd-");
		writeConfig(join(cwd, ".pi"), "bytefly.json", { price: {} });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		await withAgentDir(() => {
			expect(loadByteflyConfig(cwd)).toEqual(DEFAULT_BYTEFLY_CONFIG);
		}, "bytefly-price-agent-");
	});

	test("a USD document gets the dollar table without stating one", () => {
		const usd = normalizeByteflyConfig({ currency: { code: "USD" } }, DEFAULT_BYTEFLY_CONFIG);
		expect(usd.rates["deepseek/deepseek-flash"]?.input).toBe(0.3);
		expect(usd.rates["deepseek/deepseek-v4-pro"]?.output).toBe(3.96);
		expect(usd.currency.decimals).toBe(3);
		expect(DEFAULT_RATES_USD["deepseek/deepseek-flash"]?.output).toBe(1.2);
	});

	test("switching the code does not reinterpret a hand-written table", () => {
		const cny = normalizeByteflyConfig({ rates: { "acme/model": { input: 7, output: 7 } } }, DEFAULT_BYTEFLY_CONFIG);
		const usd = normalizeByteflyConfig({ currency: { code: "USD" } }, cny);

		expect(usd.rates["acme/model"]).toBeUndefined();
		expect(usd.rates["deepseek/deepseek-flash"]?.input).toBe(0.3);
	});

	test("rates stated with the code merge over that currency's table", () => {
		const usd = normalizeByteflyConfig(
			{ currency: { code: "USD" }, rates: { "deepseek/deepseek-flash": { output: 9 } } },
			DEFAULT_BYTEFLY_CONFIG,
		);

		expect(usd.rates["deepseek/deepseek-flash"]?.output).toBe(9);
		expect(usd.rates["deepseek/deepseek-flash"]?.input).toBe(0);
		expect(usd.rates["deepseek/deepseek-v4-pro"]?.input).toBe(1.32);
	});

	test("pins a real calendar date for the checked tariff", () => {
		expect(PRICE_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const [year, month, day] = PRICE_VERIFIED_AT.split("-").map(Number) as [number, number, number];
		const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
		const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		expect(month).toBeGreaterThanOrEqual(1);
		expect(month).toBeLessThanOrEqual(12);
		expect(day).toBeGreaterThanOrEqual(1);
		expect(day).toBeLessThanOrEqual(lengths[month - 1] as number);
	});
});

describe("rate lookup", () => {
	const oneRate = (input: number): ModelRates => ({
		input,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		offPeakMultiplier: 1,
	});
	const find = (
		rates: Readonly<Record<string, ModelRates>>,
		provider: string | null,
		model: string | null,
	): ModelRates | undefined => createRateLookup(rates)(provider, model);

	test("prefers the most specific key", () => {
		const exact = oneRate(1);
		expect(
			find(
				{ "deepseek/deepseek-flash": exact, "*/deepseek-flash": oneRate(2), "deepseek/*": oneRate(3), "*": oneRate(4) },
				"deepseek",
				"deepseek-flash",
			),
		).toBe(exact);
	});

	test("falls back through the wildcard levels in order", () => {
		expect(
			find({ "*/deepseek-flash": oneRate(2), "deepseek/*": oneRate(3) }, "deepseek", "deepseek-flash")?.input,
		).toBe(2);
		expect(find({ "deepseek/*": oneRate(3), "*": oneRate(4) }, "deepseek", "other")?.input).toBe(3);
		expect(find({ "*": oneRate(4) }, "anything", "any")?.input).toBe(4);
	});

	test("matches a prefix pattern only below an exact one", () => {
		expect(find({ "*/gpt-*": oneRate(9) }, "openai", "gpt-5")?.input).toBe(9);
		expect(find({ "*/gpt-5": oneRate(1), "*/gpt-*": oneRate(9) }, "openai", "gpt-5")?.input).toBe(1);
	});

	test("splits a key at its first slash, so a model id may contain one", () => {
		expect(
			find({ "openrouter/anthropic/claude-fable-5": oneRate(7) }, "openrouter", "anthropic/claude-fable-5")?.input,
		).toBe(7);
		expect(find({ "*/anthropic/*": oneRate(8) }, "openrouter", "anthropic/claude-fable-5")?.input).toBe(8);
		expect(find({ "*/anthropic/claude-*": oneRate(9) }, "openrouter", "anthropic/claude-fable-5")?.input).toBe(9);
	});

	test("uses the catch-all for a record that names no model", () => {
		expect(find({ "deepseek/*": oneRate(3), "*": oneRate(4) }, null, null)?.input).toBe(4);
	});

	test("returns undefined when nothing matches and rejects a bare key", () => {
		expect(find({ "anthropic/opus-4.5": oneRate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
		expect(find({}, "deepseek", "deepseek-flash")).toBeUndefined();
		expect(find({ deepseek: oneRate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
	});

	test("remembers the last match without leaking it to another record", () => {
		const lookup = createRateLookup({ "deepseek/*": oneRate(3), "openai/*": oneRate(5) });
		expect(lookup("deepseek", "deepseek-flash")?.input).toBe(3);
		expect(lookup("deepseek", "deepseek-flash")?.input).toBe(3);
		expect(lookup("openai", "gpt-5")?.input).toBe(5);
		expect(lookup("deepseek", "deepseek-v4-pro")?.input).toBe(3);
	});
});

describe("peak schedule", () => {
	/** The DeepSeek peak windows: 09:00-12:00 and 14:00-18:00, Monday to Friday. */
	const deepseekSchedule = {
		timezone: "Asia/Shanghai",
		windows: [
			{ days: [1, 2, 3, 4, 5], from: 540, to: 720 },
			{ days: [1, 2, 3, 4, 5], from: 840, to: 1080 },
		],
	};
	const utc = (year: number, month: number, day: number, hour: number, minute = 0): number =>
		Date.UTC(year, month, day, hour, minute);

	test("reads a window, defaulting the days to every day", () => {
		expect(parseWindow({ from: " 09:00 ", to: "12:00" })).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 });
		expect(parseWindow({ days: [5, 1, 1], from: "22:00", to: "02:00" })).toEqual({
			days: [1, 5],
			from: 1320,
			to: 120,
		});
	});

	test("drops a malformed window instead of guessing", () => {
		expect(parseWindow({ from: "9:5", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: "09:60", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: "09:00", to: "09:00" })).toBeNull();
		expect(parseWindow({ from: "24:00", to: "12:00" })).toBeNull();
		expect(parseWindow({ from: 540, to: "12:00" })).toBeNull();
		expect(parseWindow({ days: [8], from: "09:00", to: "12:00" })).toBeNull();
		expect(parseWindow("09:00-12:00")).toBeNull();
		expect(parseWindow(undefined)).toBeNull();
	});

	test("matches a weekday window in its own zone", () => {
		const format = peakFormatter("Asia/Shanghai");
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 3), format)).toBe(true);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 0), format)).toBe(false);
	});

	test("treats the end of a window as off-peak and excludes a weekend", () => {
		const format = peakFormatter("Asia/Shanghai");
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 3, 59), format)).toBe(true);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 4), format)).toBe(false);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 5), format)).toBe(false);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 6), format)).toBe(true);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 10), format)).toBe(false);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 3, 3), format)).toBe(false);
	});

	test("reads the configured zone, not UTC", () => {
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 3), peakFormatter("Asia/Shanghai"))).toBe(true);
		expect(isPeak(deepseekSchedule, utc(2026, 0, 5, 3), peakFormatter("UTC"))).toBe(false);
	});

	test("wraps a window past midnight and keeps its opening day", () => {
		const schedule = { timezone: "UTC", windows: [{ days: [1], from: 1320, to: 120 }] };
		const format = peakFormatter("UTC");
		expect(isPeak(schedule, utc(2026, 0, 5, 23), format)).toBe(true);
		expect(isPeak(schedule, utc(2026, 0, 6, 1), format)).toBe(true);
		expect(isPeak(schedule, utc(2026, 0, 6, 3), format)).toBe(false);
		expect(isPeak(schedule, utc(2026, 0, 5, 1), format)).toBe(false);
	});

	test("treats an empty schedule as always peak", () => {
		expect(isPeak({ timezone: "UTC", windows: [] }, utc(2026, 0, 5, 3), peakFormatter("UTC"))).toBe(true);
	});
});

describe("pricer", () => {
	test("prices a covered model from the dollar table, at peak and off-peak", () => {
		const price = createPricer(usdConfig());
		const peak = price([record({ input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK })]);
		const offPeak = price([record({ input: 1_000_000, output: 1_000_000, at: MONDAY_OFF_PEAK })]);

		expect(peak.cost).toBeCloseTo(1.5);
		expect(offPeak.cost).toBeCloseTo(0.75);
	});

	test("prices the pro model from the dollar table", () => {
		const totals = createPricer(usdConfig())([
			record({ model: "deepseek-v4-pro", input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK }),
		]);
		expect(totals.cost).toBeCloseTo(5.28);
	});

	test("falls back to Pi's recorded dollars for an uncovered model, and only in USD", () => {
		const usd = createPricer(usdConfig())([
			record({ provider: "other", model: "unpriced", recordedCost: 0.4 }),
			record({ input: 1_000_000, recordedCost: 0.25, at: MONDAY_PEAK }),
		]);
		expect(usd.cost).toBeCloseTo(0.4 + 0.3);
		expect(usd.input).toBe(1_000_000);
		expect(createPricer(deepseek())([record({ provider: "other", model: "unpriced", recordedCost: 0.4 })]).cost).toBe(
			0,
		);
	});

	test("bills each token class at its own rate", () => {
		const price = createPricer(
			config({
				rates: { "*": { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, offPeakMultiplier: 1 } },
				peak: { timezone: "UTC", windows: [] },
			}),
		);
		expect(
			price([record({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })]).cost,
		).toBeCloseTo(10);
	});

	test("matches the published DeepSeek example, peak and off-peak", () => {
		const price = createPricer(deepseek());
		const tokens = { input: 1_000_000, output: 1_000_000 };
		expect(price([record({ ...tokens, at: MONDAY_PEAK })]).cost).toBeCloseTo(10);
		expect(price([record({ ...tokens, at: MONDAY_OFF_PEAK })]).cost).toBeCloseTo(5);
	});

	test("prices an undated record at peak and keeps a flat rate flat", () => {
		expect(createPricer(deepseek())([record({ input: 1_000_000 })]).cost).toBeCloseTo(2);
		const flat = config({
			rates: { "deepseek/deepseek-flash": rate },
			peak: { timezone: "UTC", windows: [] },
		});
		expect(createPricer(flat)([record({ input: 1_000_000, at: MONDAY_OFF_PEAK })]).cost).toBeCloseTo(2);
	});

	test("prices DeepSeek and its pro model from the built-in table with no config file", () => {
		const price = createPricer(config());
		const tokens = { input: 1_000_000, output: 1_000_000 };
		expect(price([record({ ...tokens, at: MONDAY_PEAK })]).cost).toBeCloseTo(10);
		expect(price([record({ ...tokens, at: MONDAY_OFF_PEAK })]).cost).toBeCloseTo(5);
		expect(price([record({ input: 1_000_000, cacheRead: 1_000_000, at: MONDAY_PEAK })]).cost).toBeCloseTo(2.04);
		expect(
			price([record({ model: "deepseek-v4-pro", input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK })]).cost,
		).toBeCloseTo(36);
	});

	test("leaves a model with no matching rate out of the total", () => {
		expect(createPricer(config())([record({ provider: "openai", model: "gpt-5", recordedCost: 0.31 })]).cost).toBe(0);
	});

	test("counts the records CNY could not rate, and prices nothing for them", () => {
		const totals = createPricer(config())([
			record({ provider: "anthropic", model: "claude-sonnet-5", recordedCost: 0.42 }),
			record({ input: 1_000_000, at: MONDAY_PEAK }),
		]);
		expect(totals.cost).toBeCloseTo(2);
		expect(totals.unpriced).toBe(1);
	});

	test("names the model behind each unpriced record, as the key that would price it", () => {
		const totals = createPricer(config())([
			record({ provider: "openrouter", model: "anthropic/claude-fable-5", recordedCost: 0.2 }),
			record({ provider: "openrouter", model: "anthropic/claude-fable-5", recordedCost: 0.2 }),
			record({ provider: "openai", model: "gpt-5", recordedCost: 0.3 }),
			// A record the history does not name a side for is priced by a wildcard key.
			record({ provider: null, model: null, recordedCost: 0.1 }),
		]);
		// Most records first, then by key, so a report names the model that costs the most.
		expect(totals.unpricedModels).toEqual([
			{ key: "openrouter/anthropic/claude-fable-5", records: 2 },
			{ key: "*/*", records: 1 },
			{ key: "openai/gpt-5", records: 1 },
		]);
		// The count is the list's sum, so the two can never disagree.
		expect(totals.unpriced).toBe(4);
	});

	test("does not name a model Pi's own amount priced, and does name one it recorded as zero", () => {
		// USD has a fallback, so a priced record is not unpriced; a zero is what Pi records
		// for a model it cannot price, and then nothing priced this record.
		const priced = createPricer(usdConfig())([
			record({ provider: "anthropic", model: "claude-sonnet-5", recordedCost: 0.4 }),
		]);
		expect(priced.unpricedModels).toEqual([]);
		const silent = createPricer(usdConfig())([record({ provider: "local", model: "llama-4", recordedCost: 0 })]);
		expect(silent.unpricedModels).toEqual([{ key: "local/llama-4", records: 1 }]);
		expect(silent.unpriced).toBe(1);
	});

	test("counts nothing when a rate matched, a rate is explicit, or USD falls back", () => {
		expect(createPricer(config())([record({ input: 1_000_000 })]).unpriced).toBe(0);
		const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 };
		expect(createPricer(config({ rates: { "*": free } }))([record({ recordedCost: 5 })]).unpriced).toBe(0);
		// USD adds Pi's recorded amount instead, so the record is priced.
		expect(
			createPricer(usdConfig())([record({ provider: "anthropic", model: "claude-sonnet-5", recordedCost: 0.4 })])
				.unpriced,
		).toBe(0);
	});

	test("honours an explicit zero rate over the recorded cost", () => {
		const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 };
		expect(createPricer(config({ rates: { "*": free } }))([record({ recordedCost: 5 })]).cost).toBe(0);
	});

	test("totals the tokens alongside the cost, including unmatched records", () => {
		const price = createPricer(deepseek());
		const totals = price([
			record({ input: 1_000_000, at: MONDAY_PEAK }),
			record({ provider: "openai", model: "gpt-5", input: 10, output: 5, recordedCost: 0.5 }),
		]);
		expect(totals.input).toBe(1_000_010);
		expect(totals.output).toBe(5);
		expect(totals.cost).toBeCloseTo(2);
	});

	test("totals each token class", () => {
		const totals = createPricer(deepseek())([
			record({ input: 100, output: 50, cacheRead: 25, cacheWrite: 5, at: MONDAY_PEAK }),
		]);
		expect(totals).toMatchObject({ input: 100, output: 50, cacheRead: 25, cacheWrite: 5 });
	});
});

describe("usage records", () => {
	const ACTIVE = { provider: "anthropic", model: "opus-4.5" };
	const u = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
		input,
		output,
		cacheRead,
		cacheWrite,
		cost: { total },
	});
	const assistant = (usage: unknown) => ({
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: { role: "assistant", provider: "anthropic", model: "opus-4.5", usage },
	});
	const toolResult = (usage: unknown, timestamp: number) => ({
		type: "message",
		message: { role: "toolResult", usage, timestamp },
	});

	test("starts every accumulation from zeroed totals the pricer then extends", () => {
		// `lib/usage.ts` keeps the five counters; the priced extras belong to the pricer,
		// so a caller that only wants totals is not handed a list it cannot fill.
		expect(zeroUsage()).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
	});

	test("reads every usage source", () => {
		const entries = [
			assistant(u(100, 50, 100, 0, 0.01)),
			{
				type: "usage",
				provider: "deepseek",
				model: "deepseek-flash",
				usage: u(10, 5, 0, 20, 0.02),
				timestamp: "2026-01-05T04:00:00.000Z",
			},
			toolResult(u(1, 1, 0, 0, 0.001), 1_700_000_000_000),
			{ type: "compaction", usage: u(2, 2, 0, 0, 0.003), timestamp: "2026-01-05T05:00:00.000Z" },
			{ type: "branch_summary", usage: u(3, 3, 0, 0, 0.004), timestamp: "2026-01-05T06:00:00.000Z" },
			{ type: "message", message: { role: "user" } },
		];

		const { records } = usageRecords(entries, ACTIVE);

		expect(records).toHaveLength(5);
		expect(records[0]).toMatchObject({ input: 100, output: 50, cacheRead: 100, recordedCost: 0.01, isAssistant: true });
		expect(records[1]).toMatchObject({
			provider: "deepseek",
			model: "deepseek-flash",
			cacheWrite: 20,
			recordedCost: 0.02,
		});
		expect(records[2]).toMatchObject({ cacheWrite: 0, at: 1_700_000_000_000 });
		expect(records[3]).toMatchObject({ input: 2, output: 2 });
		expect(records[4]).toMatchObject({ input: 3, output: 3 });
	});

	test("keeps the latest assistant cache hit rate", () => {
		expect(
			usageRecords([assistant(u(100, 50, 100, 0, 0.01)), assistant(u(100, 10, 300, 0, 0.02))], ACTIVE).cacheHitRate,
		).toBeCloseTo(75);
		expect(
			usageRecords([assistant(u(100, 50, 100, 0, 0.01)), assistant(u(100, 10, 0, 0, 0.02))], ACTIVE).cacheHitRate,
		).toBe(0);
		expect(
			usageRecords([assistant(u(100, 50, 100, 0, 0.01)), assistant(u(0, 10, 0, 0, 0.02))], ACTIVE).cacheHitRate,
		).toBeNull();
	});

	test("inherits the model in effect for an entry that does not name one", () => {
		const entries = [
			{ type: "model_change", provider: "deepseek", modelId: "deepseek-flash" },
			toolResult(u(1, 1, 0, 0, 0), 1),
		];

		expect(usageRecords(entries, ACTIVE).records[0]).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
	});

	test("lets an assistant call move the model in effect", () => {
		const entries = [assistant(u(1, 1, 0, 0, 0)), toolResult(u(1, 1, 0, 0, 0), 1)];
		const records = usageRecords(entries, { provider: "deepseek", model: "deepseek-flash" }).records;

		expect(records[1]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
	});

	test("prefers an entry's own model over the model in effect", () => {
		const entries = [
			{ type: "model_change", provider: "deepseek", modelId: "deepseek-flash" },
			assistant(u(1, 1, 0, 0, 0)),
		];

		expect(usageRecords(entries, undefined).records[0]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
	});

	test("falls back to the active model, and to none when the session has none", () => {
		const entry = { type: "compaction", usage: u(1, 1, 0, 0, 0), timestamp: "2026-01-05T05:00:00.000Z" };

		expect(usageRecords([entry], ACTIVE).records[0]).toMatchObject({ provider: "anthropic", model: "opus-4.5" });
		expect(usageRecords([entry], undefined).records[0]).toMatchObject({ provider: null, model: null });
	});

	test("prefers the entry timestamp and falls back to the message one", () => {
		const iso = usageRecords(
			[{ type: "usage", usage: u(1, 1, 0, 0, 0), timestamp: "2026-01-05T03:00:00.000Z" }],
			undefined,
		);
		const ms = usageRecords([toolResult(u(1, 1, 0, 0, 0), 1_700_000_000_000)], undefined);
		const undated = usageRecords([{ type: "compaction", usage: u(1, 1, 0, 0, 0), timestamp: "not-a-date" }], undefined);

		expect(iso.records[0]?.at).toBe(Date.parse("2026-01-05T03:00:00.000Z"));
		expect(ms.records[0]?.at).toBe(1_700_000_000_000);
		expect(undated.records[0]?.at).toBeNull();
	});

	test("is empty for no entries", () => {
		expect(usageRecords([], ACTIVE)).toEqual({ records: [], cacheHitRate: null });
	});
});

describe("delegation ledger", () => {
	const event = (over: Record<string, unknown> = {}) => ({
		agent: "explorer",
		provider: "anthropic",
		model: "opus-4.5",
		input: 1000,
		output: 200,
		cacheRead: 50,
		cacheWrite: 0,
		recordedCost: 0.02,
		at: 1_700_000_000_000,
		exitCode: 0,
		...over,
	});

	test("keeps the pricing inputs of each finished run", () => {
		const ledger = createDelegationLedger();
		ledger.note(event());

		expect(ledger.runs()).toBe(1);
		expect(ledger.records()).toEqual([
			{
				provider: "anthropic",
				model: "opus-4.5",
				input: 1000,
				output: 200,
				cacheRead: 50,
				cacheWrite: 0,
				recordedCost: 0.02,
				at: 1_700_000_000_000,
				isAssistant: true,
			},
		]);
	});

	test("advances the version on every noted run, so a reader can re-price", () => {
		const ledger = createDelegationLedger();
		expect(ledger.version()).toBe(0);
		ledger.note(event());
		ledger.note(event());
		expect(ledger.version()).toBe(2);
	});

	test("ignores a payload it cannot price", () => {
		const ledger = createDelegationLedger();
		for (const bad of [null, undefined, "event", 42, {}, { agent: "  " }, { agent: "explorer", input: "many" }]) {
			ledger.note(bad);
		}
		expect(ledger.runs()).toBe(0);
		expect(ledger.records()).toEqual([]);
		expect(ledger.version()).toBe(0);
	});

	test("keeps counting past the retention window and keeps the newest runs", () => {
		const ledger = createDelegationLedger();
		for (let index = 0; index < MAX_DELEGATION_RECORDS + 5; index++) ledger.note(event({ input: index }));

		expect(ledger.runs()).toBe(MAX_DELEGATION_RECORDS + 5);
		const records = ledger.records();
		expect(records).toHaveLength(MAX_DELEGATION_RECORDS);
		expect(records[0]?.input).toBe(5);
		expect(records.at(-1)?.input).toBe(MAX_DELEGATION_RECORDS + 4);
	});

	test("keeps a null provider, model, or timestamp as null, not invented", () => {
		const ledger = createDelegationLedger();
		ledger.note(event({ provider: null, model: null, at: null }));
		expect(ledger.records()[0]).toMatchObject({ provider: null, model: null, at: null });
	});

	test("reset forgets everything", () => {
		const ledger = createDelegationLedger();
		ledger.note(event());
		ledger.reset();
		expect(ledger.runs()).toBe(0);
		expect(ledger.records()).toEqual([]);
		expect(ledger.version()).toBe(0);
	});
});

describe("snapshot reader", () => {
	const noDelegation = () => createDelegationLedger();
	const u = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
		input,
		output,
		cacheRead,
		cacheWrite,
		cost: { total },
	});
	const assistant = (usage: unknown) => ({ type: "message", message: { role: "assistant", usage } });

	function makeCtx(overrides: Record<string, unknown> = {}): any {
		return {
			cwd: "/home/u/repo/project",
			model: { id: "opus-4.5", provider: "anthropic", contextWindow: 200000, reasoning: true },
			thinkingLevel: "high",
			getContextUsage: () => ({ tokens: 124000, contextWindow: 200000, percent: 62 }),
			sessionManager: {
				getSessionId: () => "sess",
				getLeafId: () => "leaf",
				getSessionName: () => "my-session",
				getEntries: () => [assistant(u(100, 50, 100, 0, 0.01))],
			},
			...overrides,
		};
	}

	const footerData: any = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map([["worktree", "⑂ smoke"]]),
		getAvailableProviderCount: () => 2,
		onBranchChange: () => () => {},
	};

	const millionTokens = (): any =>
		makeCtx({
			sessionManager: {
				getSessionId: () => "sess",
				getLeafId: () => "leaf",
				getSessionName: () => "my-session",
				getEntries: () => [assistant(u(1_000_000, 0, 0, 0, 0))],
			},
		});

	const priced = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
		...DEFAULT_BYTEFLY_CONFIG,
		currency: { code: "CNY", decimals: 2 },
		rates: { "anthropic/opus-4.5": { input: 2.5, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 } },
		...overrides,
	});

	test("builds a full snapshot", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		const snapshot = read(makeCtx(), footerData);

		expect(snapshot.cwd).toBe("/home/u/repo/project");
		expect(snapshot.sessionName).toBe("my-session");
		expect(snapshot.branch).toBe("main");
		expect(snapshot.statuses.get("worktree")).toBe("⑂ smoke");
		expect(snapshot.model).toEqual({ id: "opus-4.5", provider: "anthropic", reasoning: true });
		expect(snapshot.thinkingLevel).toBe("high");
		expect(snapshot.context).toEqual({ tokens: 124000, contextWindow: 200000, percent: 62 });
		expect(snapshot.usage.cost).toBe(0);
		expect(snapshot.currency).toEqual({ code: "CNY", decimals: 2 });
		expect(snapshot.cacheHitRate).toBeCloseTo(50);
		expect(snapshot.providerCount).toBe(2);
	});

	test("falls back to the model context window when usage is unknown", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		expect(read(makeCtx({ getContextUsage: () => undefined }), footerData).context).toEqual({
			tokens: null,
			contextWindow: 200000,
			percent: null,
		});
	});

	test("reports no model", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		const snapshot = read(makeCtx({ model: undefined, getContextUsage: () => undefined }), footerData);

		expect(snapshot.model).toBeNull();
		expect(snapshot.context.contextWindow).toBe(0);
	});

	test("leaves a model with no matching rate out of the total", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		expect(read(makeCtx(), footerData).usage.cost).toBe(0);
	});

	test("prices from a configured rate and carries its currency", () => {
		const read = createSnapshotReader(priced(), noDelegation());
		const snapshot = read(millionTokens(), footerData);

		expect(snapshot.usage.cost).toBeCloseTo(2.5);
		expect(snapshot.currency).toEqual({ code: "CNY", decimals: 2 });
	});

	test("memoizes the usage scan until the branch leaf moves", () => {
		let reads = 0;
		const ctx = makeCtx({
			sessionManager: {
				getSessionId: () => "sess",
				getLeafId: () => "leaf-1",
				getSessionName: () => "my-session",
				getEntries: () => {
					reads++;
					return [assistant(u(100, 50, 0, 0, 0.5))];
				},
			},
		});
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());

		read(ctx, footerData);
		read(ctx, footerData);
		expect(reads).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(reads).toBe(2);
	});

	test("memoizes the context estimate until the leaf or the model moves", () => {
		let estimates = 0;
		const ctx = makeCtx({
			getContextUsage: () => {
				estimates++;
				return { tokens: 124000, contextWindow: 200000, percent: 62 };
			},
		});
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());

		read(ctx, footerData);
		read(ctx, footerData);
		expect(estimates).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(estimates).toBe(2);

		ctx.model = { ...ctx.model, id: "sonnet-4.5" };
		read(ctx, footerData);
		expect(estimates).toBe(3);
	});

	test("prices child runs separately and leaves the session total alone", () => {
		const ledger = createDelegationLedger();
		ledger.note({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1_000_000,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0,
			at: null,
			exitCode: 0,
		});
		const read = createSnapshotReader(priced(), ledger);
		const snapshot = read(millionTokens(), footerData);

		expect(snapshot.usage.cost).toBeCloseTo(2.5);
		expect(snapshot.delegation).toEqual({
			runs: 1,
			usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 2.5 },
		});
	});

	test("re-prices the roll-up when a new child run lands", () => {
		const ledger = createDelegationLedger();
		const read = createSnapshotReader(priced(), ledger);
		const ctx = millionTokens();
		expect(read(ctx, footerData).delegation.runs).toBe(0);

		ledger.note({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1_000_000,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0,
			at: null,
			exitCode: 0,
		});
		const after = read(ctx, footerData);

		expect(after.delegation.runs).toBe(1);
		expect(after.delegation.usage.cost).toBeCloseTo(2.5);
		expect(after.usage.cost).toBeCloseTo(2.5);
	});

	test("a USD reader prices the child's recorded dollars", () => {
		const ledger = createDelegationLedger();
		ledger.note({
			agent: "explorer",
			provider: "other",
			model: "unpriced",
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0.4,
			at: null,
			exitCode: 0,
		});
		const read = createSnapshotReader(priced({ currency: { code: "USD", decimals: 2 }, rates: {} }), ledger);

		expect(read(makeCtx(), footerData).delegation.usage.cost).toBeCloseTo(0.4);
	});

	test("peeks the last priced usage, and nothing before the first frame", () => {
		const read = createSnapshotReader(priced(), noDelegation());
		expect(read.peek()).toBeUndefined();

		const snapshot = read(millionTokens(), footerData);
		// The count and the models ride along on the same read, so the unpriced notice
		// never re-prices the session.
		expect(read.peek()).toEqual(snapshot.usage);
		expect(snapshot.usage.unpriced).toBe(0);
		expect(snapshot.usage.unpricedModels).toEqual([]);
	});
});

describe("the unpriced notice", () => {
	const models = [
		{ key: "openrouter/anthropic/claude-fable-5", records: 2 },
		{ key: "openai/gpt-5", records: 1 },
	];

	test("names the models, counts the records, and offers both fixes", () => {
		const notice = unpricedNotice(models);
		expect(notice.content).toContain("3 records have no rate");
		expect(notice.content).toContain("openrouter/anthropic/claude-fable-5, openai/gpt-5");
		expect(notice.content).toContain("USD");
		expect(notice.content).toContain("price.rates");
		// The transcript card carries one item per model, with its record count.
		expect(notice.details.items).toEqual([
			{ label: "openrouter/anthropic/claude-fable-5", detail: "2 records" },
			{ label: "openai/gpt-5", detail: "1 record" },
		]);
	});

	test("counts what it does not name", () => {
		const many = Array.from({ length: NAMED_MODELS + 2 }, (_, index) => ({ key: `p/m${index}`, records: 1 }));
		expect(unpricedNotice(many).content).toContain(`+2 more`);
		expect(unpricedNotice(many).details.items).toHaveLength(NAMED_MODELS);
	});

	test("says one record in the singular, and the body leads with the first key", () => {
		expect(unpricedNotice([{ key: "a/b", records: 1 }]).content).toContain("1 record has");
		expect(unpricedBody(models)).toBe(
			"3 records with no rate · openrouter/anthropic/claude-fable-5 · use USD or add price.rates",
		);
	});
});

describe("budget", () => {
	const CNY = CURRENCY_DEFAULTS.CNY;

	test("treats the threshold as inclusive", () => {
		expect(budgetState(5, 4.99).exceeded).toBe(false);
		expect(budgetState(5, 5).exceeded).toBe(true);
		expect(budgetState(5, 6).exceeded).toBe(true);
	});

	test("is off when the budget is zero, negative, or not a number", () => {
		for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(budgetState(limit, 1_000).exceeded).toBe(false);
			expect(budgetState(limit, 1_000).limit).toBe(0);
		}
	});

	test("treats a missing or negative spend as zero", () => {
		expect(budgetState(5, Number.NaN).spent).toBe(0);
		expect(budgetState(5, -2).spent).toBe(0);
		expect(budgetState(5, -2).exceeded).toBe(false);
	});

	test("names both figures in the configured currency", () => {
		const notice = budgetNotice(budgetState(5, 5.25), CNY);

		expect(notice.content).toContain("¥5.25 of ¥5");
		expect(notice.details.items).toEqual([
			{ label: "spent", detail: "¥5.25" },
			{ label: "budget", detail: "¥5" },
		]);
	});

	test("is a warning, not a failure, and says the session continues", () => {
		const notice = budgetNotice(budgetState(5, 5.25), CNY);

		expect(notice.details.severity).toBe("warn");
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("Session budget reached");
		expect(notice.content).toContain("the session continues");
		expect(notice.content).toContain("price.budget");
	});

	test("follows the currency's precision and shows a sub-minor-unit spend", () => {
		expect(budgetNotice(budgetState(2, 2.0004), CURRENCY_DEFAULTS.USD).content).toContain("$2.000 of $2");
		expect(budgetNotice(budgetState(0.001, 0.001), CNY).content).toContain("¥<0.01 of ¥<0.01");
	});

	test("keeps a ceiling's cents but drops its trailing zeros", () => {
		expect(budgetBody(budgetState(5, 6), CNY)).toBe("Session budget reached · ¥6.00 of ¥5");
		expect(budgetBody(budgetState(7.5, 8), CNY)).toBe("Session budget reached · ¥8.00 of ¥7.5");
	});

	test("is one body line naming the figures", () => {
		expect(budgetBody(budgetState(5, 6), CNY)).toBe("Session budget reached · ¥6.00 of ¥5");
	});
});

describe("footer formatting", () => {
	test("always renders the configured decimals and never reports a positive sub-unit as zero", () => {
		expect(formatCost(0.31)).toBe("¥0.31");
		expect(formatCost(1)).toBe("¥1.00");
		expect(formatCost(12.5)).toBe("¥12.50");
		expect(formatCost(0.04)).toBe("¥0.04");
		expect(formatCost(0)).toBe("¥0.00");
		expect(formatCost(0.004)).toBe("¥<0.01");
		expect(formatCost(12.5, { code: "USD", decimals: 2 })).toBe("$12.50");
		expect(formatCost(0.004, { code: "USD", decimals: 2 })).toBe("$<0.01");
		expect(formatCost(0, { code: "USD", decimals: 2 })).toBe("$0.00");
		expect(formatCost(12.3456, { code: "USD", decimals: 3 })).toBe("$12.346");
		expect(formatCost(0.4, { code: "USD", decimals: 0 })).toBe("$<1");
		expect(formatCost(0.4, { code: "CNY", decimals: 0 })).toBe("¥<1");
	});

	test("rounds a percentage and marks an unknown one", () => {
		expect(formatPercent(62.4)).toBe("62%");
		expect(formatPercent(null)).toBe("?");
	});

	test("shortens a path under home at each level", () => {
		expect(formatCwd("/home/u/repo/project", "/home/u", 0)).toBe("~/repo/project");
		expect(formatCwd("/home/u/repo/project", "/home/u", 1)).toBe("~/project");
		expect(formatCwd("/home/u/repo/project", "/home/u", 2)).toBe("project");
		expect(formatCwd("/home/u", "/home/u", 0)).toBe("~");
		expect(formatCwd("/home/u", "/home/u", 1)).toBe("~");
	});

	test("shortens a path outside home, or with no home", () => {
		expect(formatCwd("/var/log/nginx", "/home/u", 0)).toBe("/var/log/nginx");
		expect(formatCwd("/var/log/nginx", "/home/u", 1)).toBe("…/log/nginx");
		expect(formatCwd("/var/log/nginx", "/home/u", 2)).toBe("nginx");
		expect(formatCwd("/tmp/x", undefined, 0)).toBe("/tmp/x");
	});

	test("handles Windows paths", () => {
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 0)).toBe("~/repo/project");
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 1)).toBe("~/project");
		expect(formatCwd("C:\\Users\\gavin\\repo\\project", "C:\\Users\\gavin", 2)).toBe("project");
		expect(formatCwd("D:\\work\\thing", "C:\\Users\\gavin", 1)).toBe("…/work/thing");
	});

	test("steps the context role at the thresholds", () => {
		expect(contextRole(null)).toBe("meta");
		expect(contextRole(0)).toBe("meta");
		expect(contextRole(50)).toBe("meta");
		expect(contextRole(70)).toBe("meta");
		expect(contextRole(71)).toBe("warn");
		expect(contextRole(90)).toBe("warn");
		expect(contextRole(91)).toBe("bad");
	});

	test("maps every thinking level to its theme token", () => {
		expect(thinkingColor("off")).toBe("thinkingOff");
		expect(thinkingColor("minimal")).toBe("thinkingMinimal");
		expect(thinkingColor("low")).toBe("thinkingLow");
		expect(thinkingColor("medium")).toBe("thinkingMedium");
		expect(thinkingColor("high")).toBe("thinkingHigh");
		expect(thinkingColor("xhigh")).toBe("thinkingXhigh");
		expect(thinkingColor("max")).toBe("thinkingMax");
		expect(thinkingColor("nonsense" as ThinkingLevel)).toBe("thinkingOff");
	});

	test("keeps a short label and truncates by display width", () => {
		expect(truncateLabel("main", 10)).toBe("main");
		expect(truncateLabel("feature/long-name", 8)).toBe("feature…");
		expect(truncateLabel("項目項目項目", 5)).toBe("項目…");
	});
});

describe("status transforms", () => {
	test("keeps only the icon of an icon+label status and the count of a badge", () => {
		expect(compactStatus(`${GLYPHS.plan} plan`)).toBe(GLYPHS.plan);
		expect(compactStatus("↺ 2")).toBe("↺2");
		expect(compactStatus("▸ 12")).toBe("▸12");
	});

	test("preserves color while compacting and strips non-SGR sequences", () => {
		expect(compactStatus("\x1b[33m↺ 3\x1b[39m")).toBe("\x1b[33m↺3\x1b[39m");
		expect(compactStatus("ab\x1b[2J")).toBe("ab");
		expect(compactStatus("a\x1b]0;title\x07b")).toBe("ab");
	});

	test("does not mistake a numeric label for a count", () => {
		expect(compactStatus(`${GLYPHS.plan} plan · 2024`)).toBe(GLYPHS.plan);
	});

	test("removes a trailing detail but keeps leading styling", () => {
		expect(dropStatusDetail(`${GLYPHS.plan} plan · add-rate-limiting`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail(`\x1b[33m${GLYPHS.plan} plan · add-rate-limiting\x1b[39m`)).toBe(
			`\x1b[33m${GLYPHS.plan} plan\x1b[39m`,
		);
		expect(dropStatusDetail(`${GLYPHS.plan} plan`)).toBe(`${GLYPHS.plan} plan`);
		expect(dropStatusDetail("↺ 2")).toBe("↺ 2");
	});
});

describe("footer segments", () => {
	test("shrinks the working directory through full, parent, and base forms", () => {
		const segment = pwdSegment(fullSnapshot(), fakeTheme, "/home/u");

		expect(segment.id).toBe("pwd");
		expect(segment.forms).toEqual(["~/repo/project", "~/project", "project"]);
		expect(segment.droppable).toBe(false);
		expect(segment.separator).toBe("");
	});

	test("brackets a session name and truncates it to the label limit", () => {
		expect(sessionSegment(fullSnapshot(), fakeTheme)).toBeNull();
		const segment = sessionSegment(fullSnapshot({ sessionName: "feature-refactor-session" }), fakeTheme);

		expect(segment?.id).toBe("session");
		expect(segment?.forms).toEqual(["[feature-refactor-session]", "[feature-refac…]"]);
		expect(segment?.separator).toBe(CONFIG.separators.item);
	});

	test("shows the branch chip and marks a detached head as a warning", () => {
		expect(branchSegment(fullSnapshot({ branch: null }), fakeTheme)).toBeNull();
		expect(branchSegment(fullSnapshot(), fakeTheme)?.forms).toEqual([`${GLYPHS.branch} main`]);

		const theme = makeRecordingTheme() as any;
		const detached = branchSegment(fullSnapshot({ branch: "detached" }), theme);
		expect(detached?.forms).toEqual([`${GLYPHS.detached} detached`]);
		expect(theme.calls).toContainEqual(["warning", GLYPHS.detached]);
		expect(theme.calls).toContainEqual(["warning", "detached"]);
	});

	test("shrinks the worktree chip to its label, then its icon", () => {
		expect(worktreeSegment(fullSnapshot({ statuses: new Map() }), fakeTheme)).toBeNull();
		expect(worktreeSegment(fullSnapshot(), fakeTheme)?.forms).toEqual([`${GLYPHS.worktree} smoke`, GLYPHS.worktree]);
		expect(
			worktreeSegment(fullSnapshot({ statuses: new Map([[STATUS_KEYS.worktree, GLYPHS.worktree]]) }), fakeTheme)?.forms,
		).toEqual([GLYPHS.worktree]);
	});

	test("shrinks the browse chip to its port, then its icon", () => {
		expect(browseSegment(fullSnapshot({ statuses: new Map() }), fakeTheme)).toBeNull();
		const segment = browseSegment(
			fullSnapshot({ statuses: new Map([[STATUS_KEYS.browse, `${GLYPHS.browse} 4780`]]) }),
			fakeTheme,
		);

		expect(segment?.forms).toEqual([`${GLYPHS.browse} 4780`, `${GLYPHS.browse}4780`, GLYPHS.browse]);
		expect(segment?.separator).toBe(CONFIG.separators.item);
	});

	test("keeps an alert out of the mode slot", () => {
		const statuses = new Map([
			[STATUS_KEYS.jobs, "▸ 1"],
			[STATUS_KEYS.jobsFailure, "✗ 1"],
		]);

		expect(alertSegment(fullSnapshot({ statuses }), fakeTheme)?.forms).toEqual(["✗ 1", "✗1"]);
		expect(modesSegment(fullSnapshot({ statuses }), fakeTheme)?.forms).toEqual(["▸ 1", "▸1"]);
	});

	test("orders the mode slot by key", () => {
		const ordered = modesSegment(
			fullSnapshot({
				statuses: new Map([
					["zeta", "Z"],
					["alpha", "A"],
				]),
			}),
			fakeTheme,
		);
		expect(ordered?.forms[0]).toBe("A · Z");
	});

	test("drops the plan file name from the mode chip and keeps the wechat chip", () => {
		const themed = `\x1b[33m${GLYPHS.plan} plan · add-rate-limiting\x1b[39m`;
		const plan = modesSegment(fullSnapshot({ statuses: new Map([[STATUS_KEYS.planMode, themed]]) }), fakeTheme);
		expect(plan?.forms[0]).toBe(`\x1b[33m${GLYPHS.plan} plan\x1b[39m`);

		const wechat = modesSegment(
			fullSnapshot({ statuses: new Map([[STATUS_KEYS.wechat, `${GLYPHS.wechat} wechat`]]) }),
			fakeTheme,
		);
		expect(wechat?.forms).toEqual([`${GLYPHS.wechat} wechat`, GLYPHS.wechat]);
	});

	test("has no status slot when every status is routed elsewhere", () => {
		expect(modesSegment(fullSnapshot({ statuses: new Map() }), fakeTheme)).toBeNull();
		expect(
			modesSegment(fullSnapshot({ statuses: new Map([[STATUS_KEYS.worktree, GLYPHS.worktree]]) }), fakeTheme),
		).toBeNull();
		expect(
			modesSegment(fullSnapshot({ statuses: new Map([[STATUS_KEYS.browse, GLYPHS.browse]]) }), fakeTheme),
		).toBeNull();
	});

	test("steps the context gauge down through its widths and colors by severity", () => {
		const segment = contextSegment(fullSnapshot(), fakeTheme);
		expect(segment.forms).toHaveLength(4);
		expect(segment.forms[0]).toContain("62%");
		expect(segment.forms[0]).toContain("▰");
		expect(segment.forms[3]).toBe("62%");

		const unknown = contextSegment(
			fullSnapshot({ context: { tokens: null, contextWindow: 200000, percent: null } }),
			fakeTheme,
		);
		expect(unknown.forms).toEqual(["?"]);

		const theme = makeRecordingTheme() as any;
		contextSegment(fullSnapshot({ context: { tokens: 190000, contextWindow: 200000, percent: 95 } }), theme);
		expect(theme.calls).toContainEqual(["error", "95%"]);
	});

	test("shows the context window only when it is known", () => {
		expect(
			windowSegment(fullSnapshot({ context: { tokens: null, contextWindow: 0, percent: null } }), fakeTheme),
		).toBeNull();
		expect(windowSegment(fullSnapshot(), fakeTheme)?.forms).toEqual(["/200k"]);
	});

	test("shows the session cost in the configured currency", () => {
		expect(costSegment(fullSnapshot({ usage: usageOf() }), fakeTheme)).toBeNull();
		expect(costSegment(fullSnapshot(), fakeTheme)?.forms).toEqual(["$0.31"]);
		expect(costSegment(fullSnapshot({ currency: { code: "CNY", decimals: 2 } }), fakeTheme)?.forms).toEqual(["¥0.31"]);
	});

	test("marks the records the total leaves out, and appears when the total is only short", () => {
		const two = usageOf({ cost: 1.23, unpriced: 2, unpricedModels: [{ key: "a/b", records: 2 }] });
		const segment = costSegment(fullSnapshot({ usage: two, currency: { code: "CNY", decimals: 2 } }), fakeTheme);
		// Detailed first, and a narrow bar drops the price before the warning.
		expect(segment?.forms).toEqual(["¥1.23 · 2 unpriced", "2 unpriced", "¥1.23"]);

		// A session where nothing could be priced has a total of zero; the segment used to
		// vanish here, which is the silence this exists to end.
		const silent = costSegment(
			fullSnapshot({ usage: usageOf({ unpriced: 1, unpricedModels: [{ key: "a/b", records: 1 }] }) }),
			fakeTheme,
		);
		expect(silent?.forms).toEqual(["$0.00 · 1 unpriced", "1 unpriced"]);
	});

	test("shows the budget as a ceiling beside the spend, and turns warn at it", () => {
		const under = costSegment(fullSnapshot({ budget: 5 }), fakeTheme);
		expect(under?.forms).toEqual(["$0.31/$5"]);

		const over = costSegment(fullSnapshot({ budget: 0.25 }), fakeTheme);
		expect(over?.forms).toEqual(["$0.31/$0.25"]);
		// The same condition the budget notice fires on, so the two cannot disagree.
		const reached = makeRecordingTheme() as any;
		costSegment(fullSnapshot({ budget: 0.25 }), reached);
		expect(reached.calls).toContainEqual(["warning", "$0.31/$0.25"]);
		const below = makeRecordingTheme() as any;
		costSegment(fullSnapshot({ budget: 5 }), below);
		expect(below.calls).toContainEqual(["muted", "$0.31/$5"]);
		// The ceiling is the number the user typed: its cents stay, its trailing zeros go.
		expect(costSegment(fullSnapshot({ budget: 7.5 }), fakeTheme)?.forms).toEqual(["$0.31/$7.5"]);

		// A fresh session against a ceiling shows the allowance rather than nothing.
		expect(costSegment(fullSnapshot({ usage: usageOf(), budget: 5 }), fakeTheme)?.forms).toEqual(["$0.00/$5"]);
		// And the warning still leads the narrower forms.
		const short = usageOf({ unpriced: 2, unpricedModels: [{ key: "a/b", records: 2 }] });
		expect(costSegment(fullSnapshot({ usage: short, budget: 5 }), fakeTheme)?.forms).toEqual([
			"$0.00/$5 · 2 unpriced",
			"2 unpriced",
			"$0.00/$5",
		]);
	});

	test("rolls up the child runs beside the session cost", () => {
		const zero = usageOf();
		expect(delegationSegment(fullSnapshot(), fakeTheme)).toBeNull();

		const segment = delegationSegment(
			fullSnapshot({
				delegation: { runs: 3, usage: { ...zero, input: 4000, cost: 0.12 } },
				currency: { code: "CNY", decimals: 2 },
			}),
			fakeTheme,
		);
		expect(segment?.forms).toEqual(["↳ 3 · ¥0.12", "↳ ¥0.12", "↳ 3", "↳"]);

		const unpriced = delegationSegment(
			fullSnapshot({ delegation: { runs: 2, usage: zero }, currency: { code: "CNY", decimals: 2 } }),
			fakeTheme,
		);
		expect(unpriced?.forms).toEqual(["↳ 2 · ¥0.00", "↳ ¥0.00", "↳ 2", "↳"]);
	});

	test("omits zero token directions and the whole meter when empty", () => {
		expect(tokensSegment(fullSnapshot({ usage: usageOf() }), fakeTheme)).toBeNull();
		expect(tokensSegment(fullSnapshot({ usage: usageOf({ input: 42000 }) }), fakeTheme)?.forms).toEqual(["↑42k"]);
	});

	test("shows cache tokens and a hit rate only when something was cached", () => {
		const cached = cacheSegment(
			fullSnapshot({
				usage: usageOf({ cacheRead: 96000 }),
				cacheHitRate: 87,
			}),
			fakeTheme,
		);
		expect(cached?.forms).toEqual(["R96k CH 87%"]);

		const noRate = cacheSegment(
			fullSnapshot({
				usage: usageOf({ cacheRead: 96000 }),
				cacheHitRate: null,
			}),
			fakeTheme,
		);
		expect(noRate?.forms).toEqual(["R96k"]);

		expect(
			cacheSegment(
				fullSnapshot({
					usage: usageOf({ input: 100 }),
					cacheHitRate: 0,
				}),
				fakeTheme,
			),
		).toBeNull();
	});

	test("qualifies the model with its provider only when there are several", () => {
		expect(modelSegment(fullSnapshot({ model: undefined }), fakeTheme).forms).toEqual(["no model"]);
		expect(modelSegment(fullSnapshot({ providerCount: 1 }), fakeTheme).forms).toEqual(["opus-4.5", "opus-4.5"]);
		expect(modelSegment(fullSnapshot({ providerCount: 2 }), fakeTheme).forms).toEqual([
			"(anthropic) opus-4.5",
			"opus-4.5",
		]);
	});

	test("does not repeat a provider its model id already names", () => {
		const deepseek = fullSnapshot({
			providerCount: 2,
			model: { id: "deepseek-v4-pro", provider: "deepseek", reasoning: true },
		});
		expect(modelSegment(deepseek, fakeTheme).forms).toEqual(["deepseek-v4-pro", "deepseek-v4-pro"]);

		// A provider the id does not name still earns its parenthetical.
		const routed = fullSnapshot({
			providerCount: 2,
			model: { id: "gpt-5", provider: "azure", reasoning: true },
		});
		expect(modelSegment(routed, fakeTheme).forms[0]).toBe("(azure) gpt-5");
	});

	test("shows the thinking level for a reasoning model only, in its own theme token", () => {
		expect(
			thinkingSegment(fullSnapshot({ model: { id: "gpt-4o", provider: "openai", reasoning: false } }), fakeTheme),
		).toBeNull();

		const theme = makeRecordingTheme() as any;
		const off = thinkingSegment(fullSnapshot({ thinkingLevel: null }), theme);
		expect(off?.forms).toEqual(["off"]);
		expect(theme.calls).toContainEqual(["thinkingOff", "off"]);

		const high = makeRecordingTheme() as any;
		thinkingSegment(fullSnapshot(), high);
		expect(high.calls).toContainEqual(["thinkingHigh", "high"]);
	});

	test("colors a missing model as muted and the model as accent", () => {
		const missing = makeRecordingTheme() as any;
		modelSegment(fullSnapshot({ model: undefined }), missing);
		expect(missing.calls).toContainEqual(["muted", "no model"]);

		const model = makeRecordingTheme() as any;
		modelSegment(fullSnapshot(), model);
		expect(model.calls).toContainEqual(["accent", "opus-4.5"]);
	});
});

describe("line composition", () => {
	const ids = (segments: Array<{ id: string }>) => segments.map((segment) => segment.id);

	test("routes state to the identity line and meters to the resource line", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");

		expect(ids(line1.left)).toEqual(["pwd"]);
		expect(ids(line1.right)).toEqual(["statuses", "branch", "worktree"]);
		expect(ids(line2.left)).toEqual(["context", "window", "cost", "tokens", "cache"]);
		expect(ids(line2.right)).toEqual(["model", "thinking"]);
	});

	test("puts an alert ahead of the modes it rides with", () => {
		const statuses = new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.jobsFailure, `${GLYPHS.jobsFailure} 1`],
		]);
		const [line1] = buildLines(fullSnapshot({ statuses }), fakeTheme, "/home/u");

		expect(ids(line1.right)).toEqual(["alert", "statuses", "branch"]);
	});

	test("routes a browse chip to line 1 right and out of the alerts", () => {
		const statuses = new Map([[STATUS_KEYS.browse, `${GLYPHS.browse} 4780`]]);
		const [line1, line2] = buildLines(fullSnapshot({ statuses }), fakeTheme, "/home/u");

		expect(ids(line1.right)).toEqual(["branch", "browse"]);
		expect(ids(line2.left)).not.toContain("statuses");
	});

	test("keeps the worktree chip off the alert slot", () => {
		const snapshot = fullSnapshot({ statuses: new Map([[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`]]) });
		const [line1, line2] = buildLines(snapshot, fakeTheme, "/home/u");

		expect(ids(line1.right)).toEqual(["branch", "worktree"]);
		expect(ids(line2.left)).not.toContain("statuses");
	});

	test("has no state slot when nothing is published", () => {
		const [line1] = buildLines(fullSnapshot({ statuses: new Map() }), fakeTheme, "/home/u");
		expect(ids(line1.right)).toEqual(["branch"]);
	});

	test("places the child-run roll-up after the session cost and drops it when empty", () => {
		const zero = usageOf();
		const [, line2] = buildLines(
			fullSnapshot({
				usage: usageOf({ input: 1000, cost: 0.25 }),
				currency: { code: "CNY", decimals: 2 },
				delegation: { runs: 3, usage: { ...zero, input: 4000, cost: 0.12 } },
			}),
			fakeTheme,
			"/home/u",
		);

		expect(ids(line2.left)).toEqual(["context", "window", "cost", "delegation", "tokens"]);
		const parent = line2.left.find((segment) => segment.id === "cost");
		const delegation = line2.left.find((segment) => segment.id === "delegation");
		expect(parent?.forms[0]).toBe("¥0.25");
		expect(delegation?.forms[0]).toBe("↳ 3 · ¥0.12");

		const [, fresh] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(ids(fresh.left)).not.toContain("delegation");
	});

	test("adds the session name to the identity line and omits it when unnamed", () => {
		const [named] = buildLines(fullSnapshot({ sessionName: "feature-refactor-session" }), fakeTheme, "/home/u");
		const [unnamed] = buildLines(fullSnapshot(), fakeTheme, "/home/u");

		expect(ids(named.left)).toEqual(["pwd", "session"]);
		expect(named.left.find((segment) => segment.id === "session")?.forms).toEqual([
			"[feature-refactor-session]",
			"[feature-refac…]",
		]);
		expect(ids(unnamed.left)).toEqual(["pwd"]);
	});

	test("omits the thinking segment for a non-reasoning model", () => {
		const [, line2] = buildLines(
			fullSnapshot({ model: { id: "gpt-4o", provider: "openai", reasoning: false } }),
			fakeTheme,
			"/home/u",
		);
		expect(ids(line2.right)).toEqual(["model"]);
	});
});

describe("line layout", () => {
	const WIDTHS = [100, 80, 60, 40, 24, 16];
	const render = (width: number, snapshot = fullSnapshot()): string[] =>
		buildLines(snapshot, fakeTheme, "/home/u").map((line) => renderLine(line, width, fakeTheme));

	test("fills the width and right-aligns the right zone", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line1, 100, fakeTheme);

		expect(visibleWidth(rendered)).toBe(100);
		expect(rendered).toContain("~/repo/project");
		expect(rendered).toContain(`${GLYPHS.branch} main`);
		expect(rendered.endsWith(`${GLYPHS.worktree} smoke`)).toBe(true);
	});

	test("renders every resource segment at full width", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 100, fakeTheme);

		expect(visibleWidth(rendered)).toBeLessThanOrEqual(100);
		for (const text of ["62%", "$0.31", "R96k CH 87%", "opus-4.5", "high"]) {
			expect(rendered).toContain(text);
		}
		expect(renderLine(line1, 100, fakeTheme)).toContain(`${GLYPHS.plan} plan`);
	});

	test("drops low-priority segments as the width shrinks", () => {
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const narrow = renderLine(line2, 40, fakeTheme);

		expect(visibleWidth(narrow)).toBeLessThanOrEqual(40);
		expect(narrow).toContain("62%");
		expect(narrow).not.toContain("R96k");
	});

	test("drops the mode slot before clipping the model on a narrow bar", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");

		expect(renderLine(line2, 24, fakeTheme)).toContain("opus-4.5");
		expect(renderLine(line1, 24, fakeTheme)).not.toContain(GLYPHS.plan);
	});

	test("drops tokens before cost", () => {
		const [, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line2, 50, fakeTheme);

		expect(rendered).toContain("$0.31");
		expect(rendered).not.toContain("↑42k");
	});

	test("never exceeds a very small width", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(visibleWidth(renderLine(line1, 8, fakeTheme))).toBeLessThanOrEqual(8);
		expect(visibleWidth(renderLine(line2, 8, fakeTheme))).toBeLessThanOrEqual(8);
	});

	test("never glues adjacent segments together as the width shrinks", () => {
		const [line1, line2] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		for (let width = 6; width <= 120; width++) {
			for (const line of [line1, line2]) {
				const rendered = renderLine(line, width, fakeTheme);
				expect(visibleWidth(rendered)).toBeLessThanOrEqual(width);
				expect(rendered).not.toMatch(
					new RegExp(`%[${GLYPHS.plan}${GLYPHS.worktree}${GLYPHS.branch}${GLYPHS.detached}]`),
				);
			}
		}
	});

	test("right-aligns a right-only line", () => {
		const spec = {
			left: [],
			right: [{ id: "model", weight: 1, droppable: false, separator: "", forms: ["opus-4.5"] }],
		};
		const rendered = renderLine(spec, 20, fakeTheme);

		expect(visibleWidth(rendered)).toBe(20);
		expect(rendered.endsWith("opus-4.5")).toBe(true);
		expect(rendered.startsWith(" ")).toBe(true);
	});

	test("reads the identity line as modes, then where the work happens", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		const rendered = renderLine(line1, 100, fakeTheme);

		expect(rendered).toContain(`${GLYPHS.plan} plan${CONFIG.separators.item}${GLYPHS.branch} main`);
	});

	test("keeps a failed job when the identity line sheds everything else", () => {
		const statuses = new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.jobsFailure, `${GLYPHS.jobsFailure} 1`],
		]);
		const [line1] = buildLines(fullSnapshot({ statuses }), fakeTheme, "/home/u");
		const rendered = renderLine(line1, 20, fakeTheme);

		expect(rendered).toContain(`${GLYPHS.jobsFailure} 1`);
		expect(rendered).not.toContain("main");
	});

	test("counts wide characters correctly", () => {
		const [line1] = buildLines(fullSnapshot({ cwd: "/home/u/項目", branch: null }), fakeTheme, "/home/u");
		expect(visibleWidth(renderLine(line1, 6, fakeTheme))).toBeLessThanOrEqual(6);
	});

	test("returns one line with no newline", () => {
		const [line1] = buildLines(fullSnapshot(), fakeTheme, "/home/u");
		expect(renderLine(line1, 80, fakeTheme)).not.toContain("\n");
	});

	for (const width of WIDTHS) {
		test(`renders two non-empty lines that fit width ${width}`, () => {
			const lines = render(width);
			expect(lines).toHaveLength(2);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(visibleWidth(line)).toBeGreaterThan(0);
			}
			expect(lines[0]).toContain("main");
			expect(lines[1]).toContain("opus-4.5");
			if (width >= 60) {
				expect(lines[0]).toContain(`${GLYPHS.worktree} smoke`);
				expect(lines[1]).toContain("62%");
			}
		});
	}
});

describe("footer component", () => {
	test("renders two lines from a fresh snapshot and follows the live theme", () => {
		let snapshot = fullSnapshot();
		let theme: any = makeRecordingTheme();
		let renders = 0;
		let branchChanged: (() => void) | undefined;
		let unsubscribed = 0;
		const footerData: any = {
			getGitBranch: () => snapshot.branch,
			getExtensionStatuses: () => snapshot.statuses,
			getAvailableProviderCount: () => snapshot.providerCount,
			onBranchChange: (callback: () => void) => {
				branchChanged = callback;
				return () => {
					unsubscribed += 1;
				};
			},
		};
		const component = createFooter(
			{
				requestRender: () => {
					renders += 1;
				},
			},
			footerData,
			() => snapshot,
			() => theme,
			"/home/u",
		);

		const first = component.render(80);
		expect(first).toHaveLength(2);
		expect(first.join("\n")).toContain("~/repo/project");

		snapshot = fullSnapshot({ cwd: "/home/u/other" });
		expect(component.render(80).join("\n")).toContain("~/other");

		theme = fakeTheme;
		expect(component.render(80).join("\n")).not.toContain("accent");

		branchChanged?.();
		expect(renders).toBe(1);
		component.dispose?.();
		expect(unsubscribed).toBe(1);
	});
});

/** An assistant call that Pi recorded as costing `cost` dollars. */
function assistantCall(cost: number): unknown {
	return {
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: {
			role: "assistant",
			provider: "anthropic",
			model: "opus-4.5",
			usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
		},
	};
}

/** An assistant call the built-in CNY table prices, so nothing is left unpriced. */
function deepseekCall(): unknown {
	return {
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: {
			role: "assistant",
			provider: "deepseek",
			model: "deepseek-flash",
			usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
		},
	};
}

interface FooterHarness {
	pi: any;
	ctx: any;
	footerData: any;
	footers: any[];
	messages: Array<{ message: any }>;
	bodies: string[];
	start(): Promise<void>;
	tree(): Promise<void>;
	settle(): Promise<void>;
	stop(): Promise<void>;
	render(): string[];
	subagent(event: unknown): void;
}

interface FooterHarnessOptions {
	cost?: number;
	entries?: unknown[];
	mode?: string;
}

async function withRegisteredFooter(
	price: Record<string, unknown> | undefined,
	fn: (h: FooterHarness) => Promise<void>,
	options: FooterHarnessOptions = {},
): Promise<void> {
	await withAgentDir(async (agentDir) => {
		if (price) writeConfig(agentDir, "bytefly.json", { price });
		const { pi } = makeFakePi();
		const messages: Array<{ message: any }> = [];
		pi.sendMessage = (message: any) => messages.push({ message });
		const bodies: string[] = [];
		const { ctx, footerData, footers } = fakeFooterCtx({
			mode: options.mode ?? "tui",
			entries: options.entries ?? [assistantCall(options.cost ?? 0.6)],
		});

		registerFooter(pi, { notify: (body) => bodies.push(body) });

		await fn({
			pi,
			ctx,
			footerData,
			footers,
			messages,
			bodies,
			start: () => emit(pi, "session_start", { reason: "startup" }, ctx),
			tree: () => emit(pi, "session_tree", {}, ctx),
			settle: () => emit(pi, "agent_settled", { aborted: false }, ctx),
			stop: () => emit(pi, "session_shutdown", { reason: "quit" }, ctx),
			render: () => renderFooter(footers.at(-1), footerData, 100),
			subagent: (event) => pi.events.emit(SUBAGENT_FINISHED_CHANNEL, event),
		});
	}, "bytefly-footer-agent-");
}

/** `price` configured for dollars with the given budget. */
const usdBudget = (budget: number): Record<string, unknown> => ({ currency: { code: "USD" }, budget });

describe("registerFooter lifecycle", () => {
	test("installs the footer on session start and clears it on shutdown in tui mode", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			expect(h.footers).toHaveLength(1);

			await h.stop();
			expect(h.footers.at(-1)).toBeUndefined();
		});
	});

	test("installs nothing outside tui mode", async () => {
		await withRegisteredFooter(
			undefined,
			async (h) => {
				await h.start();
				expect(h.footers).toEqual([]);
				await h.stop();
				expect(h.footers).toEqual([]);
			},
			{ mode: "print" },
		);
	});

	test("re-installs the footer when the session tree changes", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			await h.tree();
			expect(h.footers).toHaveLength(2);
		});
	});

	test("prices a finished child run in the footer roll-up", async () => {
		const price = { rates: { "anthropic/opus-4.5": { input: 2 } } };
		await withRegisteredFooter(price, async (h) => {
			await h.start();
			h.subagent({
				agent: "explorer",
				provider: "anthropic",
				model: "opus-4.5",
				input: 1_000_000,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				recordedCost: 0,
				at: null,
				exitCode: 0,
			});

			expect(h.render().join("\n")).toContain("↳ 1 · ¥2.00");
		});
	});

	test("forgets the child ledger at a new session start", async () => {
		const price = { rates: { "anthropic/opus-4.5": { input: 2 } } };
		await withRegisteredFooter(price, async (h) => {
			await h.start();
			h.subagent({
				agent: "explorer",
				provider: "anthropic",
				model: "opus-4.5",
				input: 1_000_000,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				recordedCost: 0,
				at: null,
				exitCode: 0,
			});
			expect(h.render().join("\n")).toContain("↳ 1");

			await h.start();
			expect(h.render().join("\n")).not.toContain("↳");
		});
	});
});

describe("registerFooter session budget", () => {
	test("warns once, in the transcript and through notify, when the spend passes the budget", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			const notice = h.messages[0]?.message;
			expect(notice.customType).toBe(NOTICE_TYPE);
			expect(notice.details.title).toBe("Session budget reached");
			expect(notice.details.severity).toBe("warn");
			expect(notice.content).toContain("$0.600 of $0.5");
			expect(h.bodies).toEqual(["Session budget reached · $0.600 of $0.5"]);
		});
	});

	test("stays silent on a later turn once it has warned", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			expect(h.bodies).toHaveLength(1);
		});
	});

	test("stays silent below the budget and when no budget is configured", async () => {
		await withRegisteredFooter(usdBudget(5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toEqual([]);
			expect(h.bodies).toEqual([]);
		});

		await withRegisteredFooter(usdBudget(0), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});

	test("does not repeat a warning when the session tree changes", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			await h.tree();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
		});
	});

	test("warns again in a new session", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(2);
		});
	});

	test("checks nothing outside the interactive mode", async () => {
		await withRegisteredFooter(
			usdBudget(0.5),
			async (h) => {
				await h.start();
				await h.settle();
				expect(h.messages).toEqual([]);
			},
			{ mode: "print" },
		);
	});

	test("checks nothing before a frame has priced the session", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});
});

describe("registerFooter unpriced records", () => {
	test("names the records CNY could not price, once, with both fixes", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			const notice = h.messages[0]?.message;
			expect(notice.customType).toBe(NOTICE_TYPE);
			expect(notice.details.title).toBe("Records with no rate");
			expect(notice.details.severity).toBe("info");
			// The model, not a bare count: the key is what a reader acts on.
			expect(notice.details.items).toEqual([{ label: "anthropic/opus-4.5", detail: "1 record" }]);
			expect(notice.content).toContain("price.currency.code");
			expect(notice.content).toContain("price.rates");
			expect(h.bodies).toEqual(["1 record with no rate · anthropic/opus-4.5 · use USD or add price.rates"]);
		});
	});

	test("stays silent after the first notice, including across a session-tree change", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.tree();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			expect(h.bodies).toHaveLength(1);
		});
	});

	test("warns again in a new session", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(2);
		});
	});

	test("stays silent when every record is priced: DeepSeek in CNY, anything in USD", async () => {
		await withRegisteredFooter(
			undefined,
			async (h) => {
				await h.start();
				h.render();
				await h.settle();
				expect(h.messages).toEqual([]);
			},
			{ entries: [deepseekCall()] },
		);

		// USD adds Pi's recorded amount for any model, so nothing is unpriced.
		await withRegisteredFooter(usdBudget(0), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});

	test("checks nothing before a frame has priced the session", async () => {
		await withRegisteredFooter(undefined, async (h) => {
			await h.start();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});
});
