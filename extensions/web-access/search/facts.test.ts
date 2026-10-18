import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_CONFIG, normalizeSearchConfig, type WebSearchConfig } from "./config.ts";
import { providerFacts } from "./facts.ts";

/** A config with the given fields over the defaults. */
function config(over: Partial<WebSearchConfig> = {}): WebSearchConfig {
	return { ...DEFAULT_SEARCH_CONFIG, ...over };
}

describe("providerFacts", () => {
	test("reports the keyless default when nothing is configured", () => {
		expect(providerFacts(config())).toEqual({
			provider: "duckduckgo",
			reason: "default",
			configured: true,
			endpoint: null,
			apiKeyEnv: null,
			keyConfigured: false,
		});
	});

	test("reports an explicit SearXNG with its endpoint", () => {
		const facts = providerFacts(config({ provider: "searxng", endpoint: "http://localhost:8080" }));
		expect(facts).toMatchObject({
			provider: "searxng",
			reason: "explicit",
			configured: true,
			endpoint: "http://localhost:8080",
		});
	});

	test("reports an explicit provider that is not configured", () => {
		const facts = providerFacts(config({ provider: "searxng" }));
		expect(facts).toMatchObject({ provider: "searxng", reason: "explicit", configured: false, endpoint: null });
	});

	test("names the key variable without ever carrying the key", () => {
		const facts = providerFacts(config({ provider: "brave", apiKeyEnv: "BRAVE_SEARCH_API_KEY" }));
		expect(facts).toMatchObject({
			provider: "brave",
			configured: false,
			apiKeyEnv: "BRAVE_SEARCH_API_KEY",
			keyConfigured: false,
		});
		expect(JSON.stringify(facts)).not.toContain("secret");
	});

	test("marks a literal key as configured", () => {
		const facts = providerFacts(config({ provider: "brave", apiKey: "literal-secret" }));
		expect(facts).toMatchObject({ provider: "brave", configured: true, keyConfigured: true });
		expect(JSON.stringify(facts)).not.toContain("literal-secret");
	});

	test("auto picks a configured SearXNG over the keyless default", () => {
		const facts = providerFacts(normalizeSearchConfig({ endpoint: "http://searx.local:8888" }));
		expect(facts).toMatchObject({ provider: "searxng", reason: "configured", endpoint: "http://searx.local:8888" });
	});

	test("has no endpoint to probe for a provider without one", () => {
		expect(providerFacts(config({ provider: "brave", apiKey: "k" })).endpoint).toBeNull();
	});
});
