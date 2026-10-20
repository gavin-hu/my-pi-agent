/**
 * Rate lookup for a usage record.
 *
 * A key is `provider/model`, and either segment may be a wildcard: `*` matches
 * anything, and a trailing star matches a prefix (`gpt-*`). The key splits at
 * its first slash, so the model segment may itself contain one — an OpenRouter
 * id is `anthropic/claude-fable-5`, and its key is
 * `openrouter/anthropic/claude-fable-5`. The most specific key wins and the
 * model segment outranks the provider one, so the documented order is
 * `provider/model`, then `any/model`, then `provider/any`, then `*`.
 *
 * `createRateLookup` prepares the table once for a config: the keys are split
 * at build time, and the last match is remembered, because a session prices
 * hundreds of records from one model in a row. Splitting every key per record
 * would rebuild the whole table on the footer's hot path, once per record.
 */

import type { ModelRates } from "./types.ts";

/** A prepared rate table: call once per record, not once per key. */
export type RateLookup = (provider: string | null, model: string | null) => ModelRates | undefined;

/** One compiled key: both segments already split out of the config string. */
interface CompiledRate {
	provider: string;
	model: string;
	value: ModelRates;
}

/** One segment's score against a value: exact 2, prefix 1, wildcard 0, no match -1. */
function segmentScore(pattern: string, value: string): number {
	if (pattern === "*") return 0;
	if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1)) ? 1 : -1;
	return pattern === value ? 2 : -1;
}

/**
 * How specifically a compiled key matches a record, or `-1` when it does not.
 *
 * The model segment dominates: the score is weighted so every model score
 * outranks any provider score.
 */
function matchRate(entry: CompiledRate, provider: string, model: string): number {
	const providerScore = segmentScore(entry.provider, provider);
	const modelScore = segmentScore(entry.model, model);
	if (providerScore < 0 || modelScore < 0) return -1;
	return modelScore * 3 + providerScore;
}

/** Prepare `rates` for one config; the returned lookup remembers its last match. */
export function createRateLookup(rates: Readonly<Record<string, ModelRates>>): RateLookup {
	const compiled: CompiledRate[] = [];
	let catchAll: ModelRates | undefined;
	for (const [key, value] of Object.entries(rates)) {
		const slash = key.indexOf("/");
		if (slash < 0) {
			// A bare key is the catch-all only when it is `*`; anything else is
			// malformed and never matches.
			if (key === "*") {
				catchAll = value;
				compiled.push({ provider: "*", model: "*", value });
			}
			continue;
		}
		compiled.push({ provider: key.slice(0, slash), model: key.slice(slash + 1), value });
	}

	let lastProvider: string | null = null;
	let lastModel: string | null = null;
	let last: ModelRates | undefined;

	return (provider, model) => {
		// A record that names no model can only be priced by the catch-all.
		if (!provider || !model) return catchAll;
		if (provider === lastProvider && model === lastModel) return last;
		let best: ModelRates | undefined;
		let bestScore = -1;
		for (const entry of compiled) {
			const score = matchRate(entry, provider, model);
			// `>` keeps the first key in config order when two are equally specific.
			if (score > bestScore) {
				best = entry.value;
				bestScore = score;
			}
		}
		lastProvider = provider;
		lastModel = model;
		last = best;
		return best;
	};
}
