import { describe, expect, test } from "bun:test";
import { DEFAULT_SEARCH_CONFIG } from "../config.ts";
import type { HttpRunner } from "../../http.ts";
import { buildBraveUrl, parseBrave, searchBrave } from "./brave.ts";
import { jsonResponse } from "../../../../test/helpers/fixtures/web-access.ts";

const config = DEFAULT_SEARCH_CONFIG;

describe("buildBraveUrl", () => {
	test("sets the query and a count clamped to Brave's maximum", () => {
		expect(buildBraveUrl("pi agent", 5).searchParams.get("q")).toBe("pi agent");
		expect(buildBraveUrl("pi agent", 5).searchParams.get("count")).toBe("5");
		expect(buildBraveUrl("pi agent", 999).searchParams.get("count")).toBe("20");
		expect(buildBraveUrl("pi agent", 0).searchParams.get("count")).toBe("1");
	});
});

describe("parseBrave", () => {
	test("maps web results and de-duplicates", () => {
		const parsed = parseBrave(
			{
				web: {
					results: [
						{ title: "A", url: "https://a.example/", description: "alpha" },
						{ title: "A again", url: "https://a.example/", description: "dup" },
						{ title: "B", url: "https://b.example/", description: "" },
					],
				},
			},
			10,
		);
		expect(parsed.answer).toBe("");
		expect(parsed.results).toEqual([
			{ title: "A", url: "https://a.example/", snippet: "alpha" },
			{ title: "B", url: "https://b.example/", snippet: "" },
		]);
	});

	test("caps at maxResults and tolerates a malformed shape", () => {
		const results = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://x/${i}` }));
		expect(parseBrave({ web: { results } }, 3).results).toHaveLength(3);
		expect(parseBrave(undefined, 3)).toEqual({ answer: "", results: [] });
	});
});

describe("searchBrave", () => {
	test("sends the subscription token and returns results", async () => {
		let token: string | undefined;
		const runner: HttpRunner = (req) => {
			token = req.headers?.["X-Subscription-Token"];
			return Promise.resolve(jsonResponse({ web: { results: [{ title: "Pi", url: "https://pi.dev/" }] } }));
		};
		const result = await searchBrave({ query: "q", maxResults: 5 }, config, runner, undefined, "secret");
		expect(token).toBe("secret");
		expect(result.results).toHaveLength(1);
	});

	test("refuses to run without a key", async () => {
		const runner: HttpRunner = () => {
			throw new Error("the runner must not be called");
		};
		await expect(searchBrave({ query: "q", maxResults: 5 }, config, runner, undefined)).rejects.toThrow("API key");
	});
});
