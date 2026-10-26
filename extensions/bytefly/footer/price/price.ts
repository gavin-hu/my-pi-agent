/**
 * Price usage records from configured rates.
 *
 * `createPricer` owns the two things that must not be rebuilt per record: the
 * matching rates and the timezone formatter. Both currencies price a record
 * from `rates` and `peak` when a key matches. They differ only for a model no
 * key matches: `USD` adds Pi's recorded dollar amount (its catalog is already
 * per model), while `CNY` adds nothing. A record neither of them prices is
 * unpriced, and it is counted by *model* rather than by record: the count says
 * the total is short, and the key says how to fix it.
 */

import { zeroUsage } from "../../../../lib/usage.ts";
import type { ByteflyConfig, ModelRates } from "./types.ts";
import type { PricedUsage, UnpricedModel, UsageRecord } from "../types.ts";
import { createRateLookup } from "./rates.ts";
import { isPeak, peakFormatter } from "./schedule.ts";

const TOKENS_PER_MILLION = 1_000_000;

/** The cost of one record's tokens at `rates`, which are per million tokens. */
function tokenCost(record: UsageRecord, rates: ModelRates): number {
	return (
		(record.input * rates.input +
			record.output * rates.output +
			record.cacheRead * rates.cacheRead +
			record.cacheWrite * rates.cacheWrite) /
		TOKENS_PER_MILLION
	);
}

/**
 * Build a pricer for one config.
 *
 * The returned function totals tokens as well as cost, so the bar's meters and
 * its price always describe the same set of records.
 */
export function createPricer(config: ByteflyConfig): (records: readonly UsageRecord[]) => PricedUsage {
	// Both currencies price from `rates` and the tariff; they differ only in what
	// an unmatched model falls back to, and Pi's recorded cost is already dollars.
	const dollars = config.currency.code === "USD";
	// Both are built once per config, never per record: the table splits every key
	// and remembers the last match, and the formatter is the expensive part.
	const lookup = createRateLookup(config.rates);
	const format = config.peak.windows.length > 0 ? peakFormatter(config.peak.timezone) : null;

	return (records) => {
		const totals: PricedUsage = { ...zeroUsage(), unpriced: 0, unpricedModels: [] };
		// One tally per model key, in first-seen order, so a report reads in the order the
		// session met the models rather than in hash order.
		const unpriced = new Map<string, number>();
		for (const record of records) {
			totals.input += record.input;
			totals.output += record.output;
			totals.cacheRead += record.cacheRead;
			totals.cacheWrite += record.cacheWrite;
			const rates = lookup(record.provider, record.model);
			if (rates !== undefined) {
				totals.cost += ratedCost(config, format, record, rates);
				continue;
			}
			if (dollars) {
				totals.cost += record.recordedCost;
				// Pi priced it, unless its own amount is zero — which is what it records for a
				// model its catalog does not know. Then nothing has priced this record.
				if (record.recordedCost !== 0) continue;
			}
			totals.unpriced += 1;
			const key = rateKey(record);
			unpriced.set(key, (unpriced.get(key) ?? 0) + 1);
		}
		totals.unpricedModels = [...unpriced.entries()]
			.map(([key, count]): UnpricedModel => ({ key, records: count }))
			.sort((a, b) => b.records - a.records || a.key.localeCompare(b.key));
		return totals;
	};
}

/**
 * The `price.rates` key that would price this record.
 *
 * `*` stands in for a side the record does not name, because that is what the lookup
 * matches; a model id that contains a slash is kept whole, the way OpenRouter's ids are.
 */
function rateKey(record: UsageRecord): string {
	return `${record.provider ?? "*"}/${record.model ?? "*"}`;
}

/** One record's cost at its matched rates, after the peak schedule. */
function ratedCost(
	config: ByteflyConfig,
	format: Intl.DateTimeFormat | null,
	record: UsageRecord,
	rates: ModelRates,
): number {
	const cost = tokenCost(record, rates);
	// An undated record is never discounted: we cannot tell which tariff applied.
	if (format === null || record.at === null) return cost;
	return isPeak(config.peak, record.at, format) ? cost : cost * rates.offPeakMultiplier;
}
