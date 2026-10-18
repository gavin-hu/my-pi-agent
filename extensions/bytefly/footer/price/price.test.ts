import { describe, expect, test } from "bun:test";
import { DEFAULT_BYTEFLY_CONFIG, normalizeByteflyConfig } from "./config.ts";
import type { ByteflyConfig } from "./types.ts";
import type { UsageRecord } from "../types.ts";
import { createPricer } from "./price.ts";

/** 2026-01-05 is a Monday; 03:00 UTC is 11:00 in Asia/Shanghai. */
const MONDAY_PEAK = Date.UTC(2026, 0, 5, 3);
/** 13:00 UTC is 21:00 in Asia/Shanghai, outside every window. */
const MONDAY_OFF_PEAK = Date.UTC(2026, 0, 5, 13);

const config = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
	...DEFAULT_BYTEFLY_CONFIG,
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

describe("USD pricing", () => {
	// Through the loader, so the dollar table is the one a USD document gets.
	const usd = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
		...normalizeByteflyConfig({ currency: { code: "USD" } }, DEFAULT_BYTEFLY_CONFIG),
		...overrides,
	});

	test("prices a covered model from the dollar table, at peak and off-peak", () => {
		const price = createPricer(usd());
		const peak = price([record({ input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK })]);
		const offPeak = price([record({ input: 1_000_000, output: 1_000_000, at: MONDAY_OFF_PEAK })]);

		// Flash: $0.30 in + $1.20 out at peak, half of that off-peak.
		expect(peak.cost).toBeCloseTo(1.5);
		expect(offPeak.cost).toBeCloseTo(0.75);
	});

	test("prices the pro model from the dollar table", () => {
		const price = createPricer(usd());
		const totals = price([record({ model: "deepseek-v4-pro", input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK })]);

		// Pro: $1.32 in + $3.96 out at peak.
		expect(totals.cost).toBeCloseTo(5.28);
	});

	test("falls back to Pi's recorded dollars for a model the table does not cover", () => {
		const price = createPricer(usd());
		const totals = price([
			record({ provider: "other", model: "unpriced", recordedCost: 0.4 }),
			record({ input: 1_000_000, recordedCost: 0.25, at: MONDAY_PEAK }),
		]);

		expect(totals.cost).toBeCloseTo(0.4 + 0.3);
		expect(totals.input).toBe(1_000_000);
	});

	test("keeps CNY mode out of the recorded fallback", () => {
		const totals = createPricer(deepseek())([record({ provider: "other", model: "unpriced", recordedCost: 0.4 })]);

		expect(totals.cost).toBe(0);
	});
});

describe("createPricer", () => {
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

	test("prices an undated record at peak", () => {
		expect(createPricer(deepseek())([record({ input: 1_000_000 })]).cost).toBeCloseTo(2);
	});

	test("keeps a flat rate flat when no schedule is configured", () => {
		const flat = config({
			rates: { "deepseek/deepseek-flash": rate },
			peak: { timezone: "UTC", windows: [] },
		});
		expect(createPricer(flat)([record({ input: 1_000_000, at: MONDAY_OFF_PEAK })]).cost).toBeCloseTo(2);
	});

	test("prices DeepSeek from the built-in table with no config file", () => {
		const price = createPricer(config());
		const tokens = { input: 1_000_000, output: 1_000_000 };
		expect(price([record({ ...tokens, at: MONDAY_PEAK })]).cost).toBeCloseTo(10);
		expect(price([record({ ...tokens, at: MONDAY_OFF_PEAK })]).cost).toBeCloseTo(5);
		expect(price([record({ input: 1_000_000, cacheRead: 1_000_000, at: MONDAY_PEAK })]).cost).toBeCloseTo(2.04);
	});

	test("prices the pro model from the built-in table", () => {
		const price = createPricer(config());
		const totals = price([record({ model: "deepseek-v4-pro", input: 1_000_000, output: 1_000_000, at: MONDAY_PEAK })]);
		expect(totals.cost).toBeCloseTo(36);
	});

	test("leaves a model with no matching rate out of the total", () => {
		const totals = createPricer(config())([record({ provider: "openai", model: "gpt-5", recordedCost: 0.31 })]);
		expect(totals.cost).toBe(0);
	});

	test("honours an explicit zero rate over the recorded cost", () => {
		const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 };
		const totals = createPricer(config({ rates: { "*": free } }))([record({ recordedCost: 5 })]);
		expect(totals.cost).toBe(0);
	});

	test("totals the tokens alongside the cost", () => {
		const totals = createPricer(deepseek())([
			record({ input: 100, output: 50, cacheRead: 25, cacheWrite: 5, at: MONDAY_PEAK }),
		]);
		expect(totals.input).toBe(100);
		expect(totals.output).toBe(50);
		expect(totals.cacheRead).toBe(25);
		expect(totals.cacheWrite).toBe(5);
	});

	test("totals only the records a rate matched", () => {
		const price = createPricer(deepseek());
		const totals = price([
			record({ input: 1_000_000, at: MONDAY_PEAK }),
			record({ provider: "openai", model: "gpt-5", recordedCost: 0.5 }),
		]);
		expect(totals.cost).toBeCloseTo(2);
	});
});
