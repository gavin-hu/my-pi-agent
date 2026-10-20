import { describe, expect, test } from "bun:test";
import { withAgentDir } from "../../test/helpers/env.ts";
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from "./config.ts";

describe("normalizeConfig", () => {
	test("keeps the defaults for missing or malformed values", () => {
		expect(normalizeConfig(undefined, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig({}, DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
		expect(normalizeConfig({ command: 12, timeoutMs: "soon", maxLogBytes: [] }, DEFAULT_CONFIG)).toEqual(
			DEFAULT_CONFIG,
		);
	});

	test("trims the override and clamps the limits", () => {
		const config = normalizeConfig(
			{ command: "  make verify  ", timeoutMs: 1, maxLogBytes: 99_999_999 },
			DEFAULT_CONFIG,
		);

		expect(config.command).toBe("make verify");
		expect(config.timeoutMs).toBe(1);
		expect(config.maxLogBytes).toBe(16_777_216);
	});

	test("accepts a disabled timeout", () => {
		expect(normalizeConfig({ timeoutMs: 0 }, DEFAULT_CONFIG).timeoutMs).toBe(0);
	});
});

describe("loadConfig", () => {
	test("returns the defaults outside a configured project", async () => {
		await withAgentDir(async () => {
			expect(loadConfig("/tmp/no-such-check-project")).toEqual(DEFAULT_CONFIG);
		});
	});
});
