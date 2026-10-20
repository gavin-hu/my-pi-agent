import { describe, expect, test } from "bun:test";
import { createRateLookup } from "./rates.ts";
import type { ModelRates } from "./types.ts";

const rate = (input: number): ModelRates => ({
	input,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	offPeakMultiplier: 1,
});

/** Compile a table the way the pricer does, then look up one record. */
const find = (
	rates: Readonly<Record<string, ModelRates>>,
	provider: string | null,
	model: string | null,
): ModelRates | undefined => createRateLookup(rates)(provider, model);

describe("createRateLookup", () => {
	test("prefers the most specific key", () => {
		const exact = rate(1);
		const rates = {
			"deepseek/deepseek-flash": exact,
			"*/deepseek-flash": rate(2),
			"deepseek/*": rate(3),
			"*": rate(4),
		};
		expect(find(rates, "deepseek", "deepseek-flash")).toBe(exact);
	});

	test("falls back through the wildcard levels in order", () => {
		expect(find({ "*/deepseek-flash": rate(2), "deepseek/*": rate(3) }, "deepseek", "deepseek-flash")?.input).toBe(2);
		expect(find({ "deepseek/*": rate(3), "*": rate(4) }, "deepseek", "other")?.input).toBe(3);
		expect(find({ "*": rate(4) }, "anything", "any")?.input).toBe(4);
	});

	test("matches a pattern key only below an exact one", () => {
		expect(find({ "*/gpt-*": rate(9) }, "openai", "gpt-5")?.input).toBe(9);
		expect(find({ "*/gpt-5": rate(1), "*/gpt-*": rate(9) }, "openai", "gpt-5")?.input).toBe(1);
	});

	test("splits a key at its first slash, so a model id may contain one", () => {
		// An OpenRouter id is `anthropic/claude-fable-5`.
		expect(
			find({ "openrouter/anthropic/claude-fable-5": rate(7) }, "openrouter", "anthropic/claude-fable-5")?.input,
		).toBe(7);
		expect(find({ "*/anthropic/*": rate(8) }, "openrouter", "anthropic/claude-fable-5")?.input).toBe(8);
		expect(find({ "*/anthropic/claude-*": rate(9) }, "openrouter", "anthropic/claude-fable-5")?.input).toBe(9);
	});

	test("uses the catch-all for a record that names no model", () => {
		expect(find({ "deepseek/*": rate(3), "*": rate(4) }, null, null)?.input).toBe(4);
	});

	test("returns undefined when nothing matches", () => {
		expect(find({ "anthropic/opus-4.5": rate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
		expect(find({}, "deepseek", "deepseek-flash")).toBeUndefined();
	});

	test("rejects a bare non-wildcard key", () => {
		expect(find({ deepseek: rate(1) }, "deepseek", "deepseek-flash")).toBeUndefined();
	});

	test("remembers the last match without leaking it to another record", () => {
		const lookup = createRateLookup({ "deepseek/*": rate(3), "openai/*": rate(5) });
		expect(lookup("deepseek", "deepseek-flash")?.input).toBe(3);
		// The repeated call is the memoized one; the next model must miss it.
		expect(lookup("deepseek", "deepseek-flash")?.input).toBe(3);
		expect(lookup("openai", "gpt-5")?.input).toBe(5);
		expect(lookup("deepseek", "deepseek-v4-pro")?.input).toBe(3);
	});
});
