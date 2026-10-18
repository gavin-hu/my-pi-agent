import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../../../test/helpers/env.ts";
import {
	DEFAULT_RATES,
	DEFAULT_BYTEFLY_CONFIG,
	loadByteflyConfig,
	normalizeByteflyConfig,
	PRICE_VERIFIED_AT,
} from "./config.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-bytefly-cfg-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

/** Write a config file into `dir`, creating the project directory if needed. */
function writeConfig(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify(value));
}

describe("normalizeByteflyConfig", () => {
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
		const config = normalizeByteflyConfig({ currency: { decimals: 9 } }, DEFAULT_BYTEFLY_CONFIG);
		expect(config.currency).toEqual({ code: "CNY", decimals: 4 });
		expect(normalizeByteflyConfig({ currency: { decimals: -1 } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual({
			code: "CNY",
			decimals: 0,
		});
	});

	test("switches the algorithm with the currency code and supplies its defaults", () => {
		const usd = normalizeByteflyConfig({ currency: { code: "usd" } }, DEFAULT_BYTEFLY_CONFIG);
		expect(usd.currency).toEqual({ code: "USD", decimals: 3 });
		const custom = normalizeByteflyConfig({ currency: { code: "USD", decimals: 2 } }, DEFAULT_BYTEFLY_CONFIG);
		expect(custom.currency).toEqual({ code: "USD", decimals: 2 });
		// An unsupported code is a typo, not a third algorithm.
		expect(normalizeByteflyConfig({ currency: { code: "EUR" } }, DEFAULT_BYTEFLY_CONFIG).currency.code).toBe("CNY");
	});

	test("a project currency code supplies the new currency's precision", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { price: { currency: { code: "USD" } } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", { price: { currency: { decimals: 0 } } });
			expect(loadByteflyConfig(cwd).currency).toEqual({ code: "USD", decimals: 3 });
		});
	});

	test("keeps the fractional rates and clamps the bounds", () => {
		const config = normalizeByteflyConfig(
			{ rates: { "a/b": { input: 0.006, output: -5, offPeakMultiplier: 2 } } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(config.rates["a/b"]).toEqual({
			input: 0.006,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			offPeakMultiplier: 1,
		});
	});

	test("drops a rate entry that states no rate at all", () => {
		const config = normalizeByteflyConfig({ rates: { "a/b": {}, "c/d": 5 } }, DEFAULT_BYTEFLY_CONFIG);
		expect(config.rates).toEqual(DEFAULT_RATES);
	});

	test("replaces a built-in rate without disturbing the others", () => {
		const config = normalizeByteflyConfig(
			{ rates: { "deepseek/deepseek-flash": { input: 1 } } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(config.rates["deepseek/deepseek-flash"]?.input).toBe(1);
		expect(config.rates["deepseek/deepseek-flash"]?.output).toBe(0);
		expect(config.rates["deepseek/deepseek-v4-pro"]).toEqual(DEFAULT_RATES["deepseek/deepseek-v4-pro"]);
	});

	test("drops a schedule stated in an unknown zone", () => {
		const config = normalizeByteflyConfig(
			{ peak: { timezone: "Mars/Olympus", windows: [{ from: "09:00", to: "12:00" }] } },
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(config.peak).toEqual({ timezone: "Asia/Shanghai", windows: [] });
	});

	test("keeps only the well-formed windows", () => {
		const config = normalizeByteflyConfig(
			{
				peak: {
					timezone: "Asia/Shanghai",
					windows: [{ from: "09:00", to: "12:00" }, { from: "9:5", to: "12:00" }, "nope"],
				},
			},
			DEFAULT_BYTEFLY_CONFIG,
		);
		expect(config.peak.timezone).toBe("Asia/Shanghai");
		expect(config.peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
	});
});

describe("loadByteflyConfig", () => {
	test("prices DeepSeek in yuan with no file at all", () => {
		return withAgentDir(() => {
			const config = loadByteflyConfig(cwd);
			expect(config.currency).toEqual({ code: "CNY", decimals: 2 });
			expect(config.rates["deepseek/deepseek-flash"]).toEqual(DEFAULT_RATES["deepseek/deepseek-flash"]);
			expect(config.peak.timezone).toBe("Asia/Shanghai");
			expect(config.peak.windows).toHaveLength(2);
		});
	});

	test("layers the global file, then the project file over it", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", {
			price: { currency: {} },
		});
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", { price: { currency: { decimals: 3 } } });
			const config = loadByteflyConfig(cwd);
			expect(config.currency).toEqual({ code: "CNY", decimals: 3 });
		});
	});

	test("merges rates key by key, the project file replacing a shared key", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", {
			price: { rates: { shared: { input: 1 }, "only-project": { input: 3 } } },
		});
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { rates: { shared: { input: 2, output: 5 }, "only-global": { input: 7 } } },
			});
			const config = loadByteflyConfig(cwd);
			expect(config.rates.shared).toEqual({
				input: 1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				offPeakMultiplier: 1,
			});
			expect(config.rates["only-global"]?.input).toBe(7);
			expect(config.rates["only-project"]?.input).toBe(3);
		});
	});

	test("keeps the global windows when a project file only overrides the zone", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { price: { peak: { timezone: "UTC" } } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { peak: { timezone: "Asia/Shanghai", windows: [{ from: "09:00", to: "12:00" }] } },
			});
			const config = loadByteflyConfig(cwd);
			expect(config.peak.timezone).toBe("UTC");
			expect(config.peak.windows).toHaveLength(1);
		});
	});

	test("replaces the windows when a project file states them", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { price: { peak: { windows: [{ from: "09:00", to: "12:00" }] } } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				price: { peak: { timezone: "UTC", windows: [{ from: "10:00", to: "11:00" }] } },
			});
			expect(loadByteflyConfig(cwd).peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
		});
	});

	test("ignores a malformed file", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "bytefly.json"), "{ not json");
		return withAgentDir(() => {
			expect(loadByteflyConfig(cwd)).toEqual(DEFAULT_BYTEFLY_CONFIG);
		});
	});
});

describe("the table follows the currency", () => {
	test("a USD document gets the dollar table without stating one", () => {
		const usd = normalizeByteflyConfig({ currency: { code: "USD" } }, DEFAULT_BYTEFLY_CONFIG);

		expect(usd.rates["deepseek/deepseek-flash"]?.input).toBe(0.3);
		expect(usd.rates["deepseek/deepseek-v4-pro"]?.output).toBe(3.96);
		expect(usd.currency.decimals).toBe(3);
	});

	test("switching the code does not reinterpret a hand-written table", () => {
		const cny = normalizeByteflyConfig({ rates: { "acme/model": { input: 7, output: 7 } } }, DEFAULT_BYTEFLY_CONFIG);
		const usd = normalizeByteflyConfig({ currency: { code: "USD" } }, cny);

		// The custom yuan entry does not survive into dollars as if it were one.
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
});

describe("PRICE_VERIFIED_AT", () => {
	test("is a real calendar date, not one that rolls over", () => {
		expect(PRICE_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const [year, month, day] = PRICE_VERIFIED_AT.split("-").map(Number) as [number, number, number];
		// A month's real length, so 2026-02-31 cannot pass as a date.
		const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
		const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		expect(month).toBeGreaterThanOrEqual(1);
		expect(month).toBeLessThanOrEqual(12);
		expect(day).toBeGreaterThanOrEqual(1);
		expect(day).toBeLessThanOrEqual(lengths[month - 1] as number);
	});
});
