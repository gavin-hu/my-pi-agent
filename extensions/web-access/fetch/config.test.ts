import { describe, expect, test } from "bun:test";
import { DEFAULT_FETCH_CONFIG, normalizeFetchConfig } from "./config.ts";

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

	test("clamps the redirect and body limits", () => {
		const config = normalizeFetchConfig({ maxRedirects: 99, maxBodyChars: 1 });
		expect(config.maxRedirects).toBe(10);
		expect(config.maxBodyChars).toBe(1_000);
	});

	test("validates the render and PDF settings", () => {
		const config = normalizeFetchConfig({
			renderJs: "sometimes" as unknown as "never",
			renderWaitUntil: "nonsense" as unknown as "load",
			renderTimeoutMs: 1,
			renderMinChars: -1,
			pdfEnabled: "yes" as unknown as boolean,
		});
		expect(config.renderJs).toBe("never");
		expect(config.renderWaitUntil).toBe("load");
		expect(config.renderTimeoutMs).toBe(1_000);
		expect(config.renderMinChars).toBe(0);
		expect(config.pdfEnabled).toBe(true);
		expect(normalizeFetchConfig({ renderJs: "always", renderWaitUntil: "networkidle" }).renderJs).toBe("always");
	});

	test("keeps a custom user agent and treats blank as the default", () => {
		expect(normalizeFetchConfig({ userAgent: " my-bot " }).userAgent).toBe("my-bot");
		expect(normalizeFetchConfig({ userAgent: "   " }).userAgent).toBe(DEFAULT_FETCH_CONFIG.userAgent);
	});
});
