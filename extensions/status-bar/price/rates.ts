/**
 * Rate lookup for a usage record.
 *
 * A key is `provider/model`, and either segment may be a wildcard: `*` matches
 * anything, and a trailing star matches a prefix (`gpt-*`). The most specific
 * key wins and the model segment outranks the provider one, so the documented
 * order is `provider/model`, then `any/model`, then `provider/any`, then `*`.
 */

import type { ModelRates } from "../types.ts";

/** One segment's score against a value: exact 2, prefix 1, wildcard 0, no match -1. */
function segmentScore(pattern: string, value: string): number {
	if (pattern === "*") return 0;
	if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1)) ? 1 : -1;
	return pattern === value ? 2 : -1;
}

/**
 * How specifically `key` matches a record, or `-1` when it does not.
 *
 * The model segment dominates: the score is weighted so every model score
 * outranks any provider score.
 */
function matchKey(key: string, provider: string, model: string): number {
	const parts = key.split("/");
	if (parts.length === 1) return key === "*" ? 0 : -1;
	if (parts.length !== 2) return -1;
	const providerScore = segmentScore(parts[0], provider);
	const modelScore = segmentScore(parts[1], model);
	if (providerScore < 0 || modelScore < 0) return -1;
	return modelScore * 3 + providerScore;
}

/** The most specific configured rate, or `undefined` when none matches. */
export function findRates(
	rates: Readonly<Record<string, ModelRates>>,
	provider: string | null,
	model: string | null,
): ModelRates | undefined {
	// A record that names no model can only be priced by the catch-all.
	if (!provider || !model) return rates["*"];
	let best: ModelRates | undefined;
	let bestScore = -1;
	for (const [key, value] of Object.entries(rates)) {
		const score = matchKey(key, provider, model);
		// `>` keeps the first key in config order when two are equally specific.
		if (score > bestScore) {
			best = value;
			bestScore = score;
		}
	}
	return best;
}
