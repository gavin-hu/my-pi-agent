import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_RATES, DEFAULT_CHROME_CONFIG, loadChromeConfig, normalizeChromeConfig } from "./config.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-chrome-cfg-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

/** Write a config file into `dir`, creating the project directory if needed. */
function writeConfig(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify(value));
}

describe("normalizeChromeConfig", () => {
	test("returns the base for a missing object", () => {
		expect(normalizeChromeConfig(undefined, DEFAULT_CHROME_CONFIG)).toEqual(DEFAULT_CHROME_CONFIG);
	});

	test("yields the defaults for garbage instead of throwing", () => {
		expect(
			normalizeChromeConfig(
				{ currency: "¥", rates: [], peak: 7, fallbackToRecordedCost: "yes" },
				DEFAULT_CHROME_CONFIG,
			),
		).toEqual(DEFAULT_CHROME_CONFIG);
		expect(
			normalizeChromeConfig(
				{ currency: { symbol: 5, decimals: "x" }, rates: { "a/b": "cheap" }, peak: { timezone: [], windows: "all" } },
				DEFAULT_CHROME_CONFIG,
			),
		).toEqual(DEFAULT_CHROME_CONFIG);
	});

	test("ignores unknown keys", () => {
		expect(normalizeChromeConfig({ bar: { width: 12 } }, DEFAULT_CHROME_CONFIG)).toEqual(DEFAULT_CHROME_CONFIG);
	});

	test("normalizes the header appearance", () => {
		const config = normalizeChromeConfig({ header: { mark: "logo", showVersion: false } }, DEFAULT_CHROME_CONFIG);
		expect(config.header).toEqual({ mark: "logo", showVersion: false });
	});

	test("keeps the base appearance for unknown or wrong-typed values", () => {
		expect(normalizeChromeConfig({ header: { mark: "banner" } }, DEFAULT_CHROME_CONFIG).header).toEqual(
			DEFAULT_CHROME_CONFIG.header,
		);
		expect(normalizeChromeConfig({ header: "logo" }, DEFAULT_CHROME_CONFIG)).toEqual(DEFAULT_CHROME_CONFIG);
	});

	test("reads the currency, capped and clamped", () => {
		const config = normalizeChromeConfig({ currency: { symbol: " MONEY ", decimals: 9 } }, DEFAULT_CHROME_CONFIG);
		expect(config.currency).toEqual({ symbol: "MONE", decimals: 4 });
		expect(normalizeChromeConfig({ currency: { decimals: -1 } }, DEFAULT_CHROME_CONFIG).currency).toEqual({
			symbol: "¥",
			decimals: 0,
		});
	});

	test("keeps the fractional rates and clamps the bounds", () => {
		const config = normalizeChromeConfig(
			{ rates: { "a/b": { input: 0.006, output: -5, offPeakMultiplier: 2 } } },
			DEFAULT_CHROME_CONFIG,
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
		const config = normalizeChromeConfig({ rates: { "a/b": {}, "c/d": 5 } }, DEFAULT_CHROME_CONFIG);
		expect(config.rates).toEqual(DEFAULT_RATES);
	});

	test("replaces a built-in rate without disturbing the others", () => {
		const config = normalizeChromeConfig({ rates: { "deepseek/deepseek-flash": { input: 1 } } }, DEFAULT_CHROME_CONFIG);
		expect(config.rates["deepseek/deepseek-flash"]?.input).toBe(1);
		expect(config.rates["deepseek/deepseek-flash"]?.output).toBe(0);
		expect(config.rates["deepseek/deepseek-v4-pro"]).toEqual(DEFAULT_RATES["deepseek/deepseek-v4-pro"]);
	});

	test("drops a schedule stated in an unknown zone", () => {
		const config = normalizeChromeConfig(
			{ peak: { timezone: "Mars/Olympus", windows: [{ from: "09:00", to: "12:00" }] } },
			DEFAULT_CHROME_CONFIG,
		);
		expect(config.peak).toEqual({ timezone: "Asia/Shanghai", windows: [] });
	});

	test("keeps only the well-formed windows", () => {
		const config = normalizeChromeConfig(
			{
				peak: {
					timezone: "Asia/Shanghai",
					windows: [{ from: "09:00", to: "12:00" }, { from: "9:5", to: "12:00" }, "nope"],
				},
			},
			DEFAULT_CHROME_CONFIG,
		);
		expect(config.peak.timezone).toBe("Asia/Shanghai");
		expect(config.peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
	});
});

describe("loadChromeConfig", () => {
	test("prices DeepSeek in yuan with no file at all", () => {
		return withAgentDir(() => {
			const config = loadChromeConfig(cwd);
			expect(config.currency).toEqual({ symbol: "¥", decimals: 2 });
			expect(config.rates["deepseek/deepseek-flash"]).toEqual(DEFAULT_RATES["deepseek/deepseek-flash"]);
			expect(config.peak.timezone).toBe("Asia/Shanghai");
			expect(config.peak.windows).toHaveLength(2);
		});
	});

	test("layers the global file, then the project file over it", () => {
		writeConfig(join(cwd, ".pi"), "chrome.json", { currency: { symbol: "¥" }, fallbackToRecordedCost: false });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "chrome.json", { currency: { symbol: "€", decimals: 3 } });
			const config = loadChromeConfig(cwd);
			expect(config.currency).toEqual({ symbol: "¥", decimals: 3 });
			expect(config.fallbackToRecordedCost).toBe(false);
		});
	});

	test("merges rates key by key, the project file replacing a shared key", () => {
		writeConfig(join(cwd, ".pi"), "chrome.json", {
			rates: { shared: { input: 1 }, "only-project": { input: 3 } },
		});
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "chrome.json", {
				rates: { shared: { input: 2, output: 5 }, "only-global": { input: 7 } },
			});
			const config = loadChromeConfig(cwd);
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
		writeConfig(join(cwd, ".pi"), "chrome.json", { peak: { timezone: "UTC" } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "chrome.json", {
				peak: { timezone: "Asia/Shanghai", windows: [{ from: "09:00", to: "12:00" }] },
			});
			const config = loadChromeConfig(cwd);
			expect(config.peak.timezone).toBe("UTC");
			expect(config.peak.windows).toHaveLength(1);
		});
	});

	test("replaces the windows when a project file states them", () => {
		writeConfig(join(cwd, ".pi"), "chrome.json", { peak: { windows: [{ from: "09:00", to: "12:00" }] } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "chrome.json", {
				peak: { timezone: "UTC", windows: [{ from: "10:00", to: "11:00" }] },
			});
			expect(loadChromeConfig(cwd).peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
		});
	});

	test("ignores a malformed file", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "chrome.json"), "{ not json");
		return withAgentDir(() => {
			expect(loadChromeConfig(cwd)).toEqual(DEFAULT_CHROME_CONFIG);
		});
	});
});
