import { describe, expect, test } from "bun:test";
import type { ModelRates } from "../types.ts";
import { findRates } from "./rates.ts";

const rate = (input: number): ModelRates => ({
	input,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	offPeakMultiplier: 1,
});

describe("findRates", () => {
	test("prefers the most specific key", () => {
		const exact = rate(1);
		const rates = {
			"deepseek/deepseek-flash": exact,
			"*/deepseek-flash": rate(2),
			"deepseek/*": rate(3),
			"*": rate(4),
		};
		expect(findRates(rates, "deepseek", "deepseek-flash")).toBe(exact);
	});

	test("falls back through the wildcard levels in order", () => {
		expect(findRates({ "*/deepseek-flash": rate(2), "deepseek/*": rate(3) }, "deepseek", "deepseek-flash")?.input).toBe(
			2,
		);
		expect(findRates({ "deepseek/*": rate(3), "*": rate(4) }, "deepseek", "other")?.input).toBe(3);
		expect(findRates({ "*": rate(4) }, "anything", "any")?.input).toBe(4);
	});

	test("matches a pattern key only below an exact one", () => {
		expect(findRates({ "*/gpt-*": rate(9) }, "openai", "gpt-5")?.input).toBe(9);
		expect(findRates({ "*/gpt-5": rate(1), "*/gpt-*": rate(9) }, "openai", "gpt-5")?.input).toBe(1);
	});

	test("uses the catch-all for a record that names no model", () => {
		expect(findRates({ "deepseek/*": rate(3), "*": rate(4) }, null, null)?.input).toBe(4);
	});

	test("returns undefined when nothing matches", () => {
		expect(findRates({ "anthropic/opus-4.5": rate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
		expect(findRates({}, "deepseek", "deepseek-flash")).toBeUndefined();
	});

	test("rejects a bare non-wildcard key", () => {
		expect(findRates({ deepseek: rate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
	});
});
