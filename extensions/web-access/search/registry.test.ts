import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_CONFIG } from "./config.ts";
import { DEFAULT_PROVIDER_ID, getProvider, providerLabel, resolveProvider, SEARCH_PROVIDERS } from "./registry.ts";
import { SEARCH_PROVIDER_IDS } from "./types.ts";

describe("provider registry", () => {
	test("implements one provider per declared id, in order", () => {
		expect(SEARCH_PROVIDERS.map((provider) => provider.id)).toEqual([...SEARCH_PROVIDER_IDS]);
	});

	test("the default provider is keyless", () => {
		expect(DEFAULT_PROVIDER_ID).toBe("duckduckgo");
		expect(getProvider(DEFAULT_PROVIDER_ID).isConfigured(DEFAULT_SEARCH_CONFIG)).toBe(true);
	});
});

describe("resolveProvider", () => {
	test("auto picks the first configured provider", () => {
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, endpoint: "https://searx.test" }).id).toBe("searxng");
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, apiKey: "k" }).id).toBe("brave");
	});

	test("auto falls back to the keyless default with no configuration", () => {
		expect(resolveProvider(DEFAULT_SEARCH_CONFIG).id).toBe("duckduckgo");
	});

	test("an explicit choice wins even when unconfigured", () => {
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, provider: "searxng" }).id).toBe("searxng");
		expect(resolveProvider({ ...DEFAULT_SEARCH_CONFIG, provider: "brave" }).id).toBe("brave");
	});
});

describe("providerLabel", () => {
	test("uses the provider label, and a generic label for none", () => {
		expect(providerLabel("searxng")).toBe("SearXNG");
		expect(providerLabel("duckduckgo")).toBe("DuckDuckGo");
		expect(providerLabel("brave")).toBe("Brave");
		expect(providerLabel("none")).toBe("Web");
	});
});
