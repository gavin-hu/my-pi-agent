import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_RATES, DEFAULT_BYTEFLY_CONFIG, loadByteflyConfig, normalizeByteflyConfig } from "./config.ts";

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
		expect(
			normalizeByteflyConfig(
				{ currency: "¥", rates: [], peak: 7, fallbackToRecordedCost: "yes" },
				DEFAULT_BYTEFLY_CONFIG,
			),
		).toEqual(DEFAULT_BYTEFLY_CONFIG);
		expect(
			normalizeByteflyConfig(
				{ currency: { symbol: 5, decimals: "x" }, rates: { "a/b": "cheap" }, peak: { timezone: [], windows: "all" } },
				DEFAULT_BYTEFLY_CONFIG,
			),
		).toEqual(DEFAULT_BYTEFLY_CONFIG);
	});

	test("ignores unknown keys", () => {
		expect(normalizeByteflyConfig({ bar: { width: 12 } }, DEFAULT_BYTEFLY_CONFIG)).toEqual(DEFAULT_BYTEFLY_CONFIG);
	});

	test("reads the currency, capped and clamped", () => {
		const config = normalizeByteflyConfig({ currency: { symbol: " MONEY ", decimals: 9 } }, DEFAULT_BYTEFLY_CONFIG);
		expect(config.currency).toEqual({ symbol: "MONE", decimals: 4 });
		expect(normalizeByteflyConfig({ currency: { decimals: -1 } }, DEFAULT_BYTEFLY_CONFIG).currency).toEqual({
			symbol: "¥",
			decimals: 0,
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
			expect(config.currency).toEqual({ symbol: "¥", decimals: 2 });
			expect(config.rates["deepseek/deepseek-flash"]).toEqual(DEFAULT_RATES["deepseek/deepseek-flash"]);
			expect(config.peak.timezone).toBe("Asia/Shanghai");
			expect(config.peak.windows).toHaveLength(2);
		});
	});

	test("layers the global file, then the project file over it", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { currency: { symbol: "¥" }, fallbackToRecordedCost: false });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", { currency: { symbol: "€", decimals: 3 } });
			const config = loadByteflyConfig(cwd);
			expect(config.currency).toEqual({ symbol: "¥", decimals: 3 });
			expect(config.fallbackToRecordedCost).toBe(false);
		});
	});

	test("merges rates key by key, the project file replacing a shared key", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", {
			rates: { shared: { input: 1 }, "only-project": { input: 3 } },
		});
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				rates: { shared: { input: 2, output: 5 }, "only-global": { input: 7 } },
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
		writeConfig(join(cwd, ".pi"), "bytefly.json", { peak: { timezone: "UTC" } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				peak: { timezone: "Asia/Shanghai", windows: [{ from: "09:00", to: "12:00" }] },
			});
			const config = loadByteflyConfig(cwd);
			expect(config.peak.timezone).toBe("UTC");
			expect(config.peak.windows).toHaveLength(1);
		});
	});

	test("replaces the windows when a project file states them", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { peak: { windows: [{ from: "09:00", to: "12:00" }] } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "bytefly.json", {
				peak: { timezone: "UTC", windows: [{ from: "10:00", to: "11:00" }] },
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

describe("legacy chrome.json migration", () => {
	test("moves a legacy chrome.json to bytefly.json and keeps its settings", () => {
		writeConfig(join(cwd, ".pi"), "chrome.json", { currency: { symbol: "€", decimals: 3 } });
		return withAgentDir(() => {
			const config = loadByteflyConfig(cwd);
			expect(config.currency).toEqual({ symbol: "€", decimals: 3 });
			expect(existsSync(join(cwd, ".pi", "bytefly.json"))).toBe(true);
			expect(existsSync(join(cwd, ".pi", "chrome.json"))).toBe(false);
		});
	});

	test("migrates the global file independently of the project file", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { fallbackToRecordedCost: false });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "chrome.json", { currency: { symbol: "€", decimals: 3 } });
			const config = loadByteflyConfig(cwd);
			expect(config.currency).toEqual({ symbol: "€", decimals: 3 });
			expect(config.fallbackToRecordedCost).toBe(false);
			expect(existsSync(join(agentDir, "bytefly.json"))).toBe(true);
			expect(existsSync(join(agentDir, "chrome.json"))).toBe(false);
		});
	});

	test("leaves a legacy file alone when the current file already exists", () => {
		writeConfig(join(cwd, ".pi"), "bytefly.json", { currency: { symbol: "$", decimals: 0 } });
		writeConfig(join(cwd, ".pi"), "chrome.json", { currency: { symbol: "€", decimals: 3 } });
		return withAgentDir(() => {
			expect(loadByteflyConfig(cwd).currency).toEqual({ symbol: "$", decimals: 0 });
			expect(existsSync(join(cwd, ".pi", "chrome.json"))).toBe(true);
		});
	});
});
