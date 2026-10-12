import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_STATUS_BAR_CONFIG, loadStatusBarConfig, normalizeStatusBarConfig } from "./config.ts";

let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-status-bar-cfg-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

/** Write a config file into `dir`, creating the project directory if needed. */
function writeConfig(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify(value));
}

describe("normalizeStatusBarConfig", () => {
	test("returns the base for a missing object", () => {
		expect(normalizeStatusBarConfig(undefined, DEFAULT_STATUS_BAR_CONFIG)).toEqual(DEFAULT_STATUS_BAR_CONFIG);
	});

	test("yields the defaults for garbage instead of throwing", () => {
		expect(
			normalizeStatusBarConfig(
				{ currency: "¥", rates: [], peak: 7, fallbackToRecordedCost: "yes" },
				DEFAULT_STATUS_BAR_CONFIG,
			),
		).toEqual(DEFAULT_STATUS_BAR_CONFIG);
		expect(
			normalizeStatusBarConfig(
				{ currency: { symbol: 5, decimals: "x" }, rates: { "a/b": "cheap" }, peak: { timezone: [], windows: "all" } },
				DEFAULT_STATUS_BAR_CONFIG,
			),
		).toEqual(DEFAULT_STATUS_BAR_CONFIG);
	});

	test("ignores unknown keys", () => {
		expect(normalizeStatusBarConfig({ bar: { width: 12 } }, DEFAULT_STATUS_BAR_CONFIG)).toEqual(
			DEFAULT_STATUS_BAR_CONFIG,
		);
	});

	test("reads the currency, capped and clamped", () => {
		const config = normalizeStatusBarConfig(
			{ currency: { symbol: " MONEY ", decimals: 9 } },
			DEFAULT_STATUS_BAR_CONFIG,
		);
		expect(config.currency).toEqual({ symbol: "MONE", decimals: 4 });
		expect(normalizeStatusBarConfig({ currency: { decimals: -1 } }, DEFAULT_STATUS_BAR_CONFIG).currency).toEqual({
			symbol: "$",
			decimals: 0,
		});
	});

	test("keeps the fractional rates and clamps the bounds", () => {
		const config = normalizeStatusBarConfig(
			{ rates: { "a/b": { input: 0.006, output: -5, offPeakMultiplier: 2 } } },
			DEFAULT_STATUS_BAR_CONFIG,
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
		const config = normalizeStatusBarConfig({ rates: { "a/b": {}, "c/d": 5 } }, DEFAULT_STATUS_BAR_CONFIG);
		expect(config.rates).toEqual({});
	});

	test("drops a schedule stated in an unknown zone", () => {
		const config = normalizeStatusBarConfig(
			{ peak: { timezone: "Mars/Olympus", windows: [{ from: "09:00", to: "12:00" }] } },
			DEFAULT_STATUS_BAR_CONFIG,
		);
		expect(config.peak).toEqual({ timezone: "UTC", windows: [] });
	});

	test("keeps only the well-formed windows", () => {
		const config = normalizeStatusBarConfig(
			{
				peak: {
					timezone: "Asia/Shanghai",
					windows: [{ from: "09:00", to: "12:00" }, { from: "9:5", to: "12:00" }, "nope"],
				},
			},
			DEFAULT_STATUS_BAR_CONFIG,
		);
		expect(config.peak.timezone).toBe("Asia/Shanghai");
		expect(config.peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
	});
});

describe("loadStatusBarConfig", () => {
	test("layers the global file, then the project file over it", () => {
		writeConfig(join(cwd, ".pi"), "status-bar.json", { currency: { symbol: "¥" }, fallbackToRecordedCost: false });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "status-bar.json", { currency: { symbol: "€", decimals: 3 } });
			const config = loadStatusBarConfig(cwd);
			expect(config.currency).toEqual({ symbol: "¥", decimals: 3 });
			expect(config.fallbackToRecordedCost).toBe(false);
		});
	});

	test("merges rates key by key, the project file replacing a shared key", () => {
		writeConfig(join(cwd, ".pi"), "status-bar.json", {
			rates: { shared: { input: 1 }, "only-project": { input: 3 } },
		});
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "status-bar.json", {
				rates: { shared: { input: 2, output: 5 }, "only-global": { input: 7 } },
			});
			const config = loadStatusBarConfig(cwd);
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
		writeConfig(join(cwd, ".pi"), "status-bar.json", { peak: { timezone: "UTC" } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "status-bar.json", {
				peak: { timezone: "Asia/Shanghai", windows: [{ from: "09:00", to: "12:00" }] },
			});
			const config = loadStatusBarConfig(cwd);
			expect(config.peak.timezone).toBe("UTC");
			expect(config.peak.windows).toHaveLength(1);
		});
	});

	test("replaces the windows when a project file states them", () => {
		writeConfig(join(cwd, ".pi"), "status-bar.json", { peak: { windows: [{ from: "09:00", to: "12:00" }] } });
		return withAgentDir((agentDir) => {
			writeConfig(agentDir, "status-bar.json", {
				peak: { timezone: "UTC", windows: [{ from: "10:00", to: "11:00" }] },
			});
			expect(loadStatusBarConfig(cwd).peak.windows).toEqual([{ days: [1, 2, 3, 4, 5, 6, 7], from: 540, to: 720 }]);
		});
	});

	test("ignores a malformed file", () => {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "status-bar.json"), "{ not json");
		return withAgentDir(() => {
			expect(loadStatusBarConfig(cwd)).toEqual(DEFAULT_STATUS_BAR_CONFIG);
		});
	});
});
