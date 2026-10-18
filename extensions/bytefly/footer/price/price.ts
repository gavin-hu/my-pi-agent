/**
 * Price usage records from configured rates.
 *
 * `createPricer` owns the two things that must not be rebuilt per record: the
 * matching rates and the timezone formatter. `currency.code` chooses the
 * algorithm: CNY prices matched records from `rates` and `peak`, while USD
 * totals Pi's recorded dollar cost and ignores both. A CNY-mode record with no
 * matching rate contributes nothing: an unpriced model shows no price at all.
 */

import { emptyUsage } from "../collect/entries.ts";
import type { ByteflyConfig, ModelRates } from "./types.ts";
import type { UsageRecord, UsageTotals } from "../types.ts";
import { findRates } from "./rates.ts";
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
export function createPricer(config: ByteflyConfig): (records: readonly UsageRecord[]) => UsageTotals {
	// Both currencies price from `rates` and the tariff; they differ only in what
	// an unmatched model falls back to, and Pi's recorded cost is already dollars.
	const dollars = config.currency.code === "USD";
	// Building a formatter is the expensive part, and only a schedule needs one.
	const format = config.peak.windows.length > 0 ? peakFormatter(config.peak.timezone) : null;

	return (records) => {
		const totals = emptyUsage();
		for (const record of records) {
			totals.input += record.input;
			totals.output += record.output;
			totals.cacheRead += record.cacheRead;
			totals.cacheWrite += record.cacheWrite;
			const rates = findRates(config.rates, record.provider, record.model);
			if (rates !== undefined) {
				totals.cost += ratedCost(config, format, record, rates);
				continue;
			}
			if (dollars) totals.cost += record.recordedCost;
		}
		return totals;
	};
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
