import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "./config.ts";

describe("normalizeConfig", () => {
	test("returns the base for an absent section", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG);
	});

	test("takes booleans and ignores wrongly typed ones", () => {
		const config = normalizeConfig({ enabled: false, showStatus: "no", wakeOnMatch: true }, DEFAULT_CONFIG);
		expect(config.enabled).toBe(false);
		expect(config.showStatus).toBe(true);
		expect(config.wakeOnMatch).toBe(true);
	});

	test("clamps numeric fields into range", () => {
		const config = normalizeConfig(
			{ maxWatchers: 0, maxMatches: 10_000, maxLogLines: -3, matchLines: 5, pollMs: 1 },
			DEFAULT_CONFIG,
		);
		expect(config.maxWatchers).toBe(1);
		expect(config.maxMatches).toBe(5000);
		expect(config.maxLogLines).toBe(1);
		expect(config.matchLines).toBe(5);
		expect(config.pollMs).toBe(100);
	});

	test("keeps the default for a non-numeric value", () => {
		const config = normalizeConfig({ matchLines: null, pollMs: "fast" }, DEFAULT_CONFIG);
		expect(config.matchLines).toBe(DEFAULT_CONFIG.matchLines);
		expect(config.pollMs).toBe(DEFAULT_CONFIG.pollMs);
	});
});
