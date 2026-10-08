import { describe, expect, test } from "bun:test";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig } from "../../../extensions/web-access/fetch/config.ts";

describe("normalizeFetchConfig", () => {
	test("returns the base config for missing input", () => {
		expect(normalizeFetchConfig(undefined)).toEqual(DEFAULT_FETCH_CONFIG);
	});

	test("clamps numeric values into range", () => {
		const config = normalizeFetchConfig({ timeoutMs: 5, maxBytes: 1, maxOutputChars: 10 });
		expect(config.timeoutMs).toBe(1_000);
		expect(config.maxBytes).toBe(1_024);
		expect(config.maxOutputChars).toBe(500);
	});

	test("only a boolean enables allowPrivateHosts", () => {
		expect(normalizeFetchConfig({ allowPrivateHosts: true }).allowPrivateHosts).toBe(true);
		expect(normalizeFetchConfig({ allowPrivateHosts: "yes" as unknown as boolean }).allowPrivateHosts).toBe(false);
	});

	test("clamps cache settings and defaults cacheEnabled", () => {
		const config = normalizeFetchConfig({
			cacheTtlMs: -5,
			cacheMaxEntries: 0,
			cacheMaxBytes: 1,
			cacheEnabled: "x" as unknown as boolean,
		});
		expect(config.cacheTtlMs).toBe(0);
		expect(config.cacheMaxEntries).toBe(1);
		expect(config.cacheMaxBytes).toBe(1_024);
		expect(config.cacheEnabled).toBe(DEFAULT_FETCH_CONFIG.cacheEnabled);
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeFetchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeFetchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_FETCH_CONFIG.userAgent);
	});
});
