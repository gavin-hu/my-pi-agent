/**
 * Price usage records from configured rates.
 *
 * `createPricer` owns the two things that must not be rebuilt per record: the
 * matching rates and the timezone formatter. A record with no matching rate
 * keeps Pi's recorded cost (in USD) unless the config turns that fallback off.
 */

import { emptyUsage } from "../collect/entries.ts";
import type { ModelRates, ByteflyConfig, UsageRecord, UsageTotals } from "../types.ts";
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
	// Building a formatter is the expensive part, and only a schedule needs one.
	const format = config.peak.windows.length > 0 ? peakFormatter(config.peak.timezone) : null;

	return (records) => {
		const totals = emptyUsage();
		for (const record of records) {
			totals.input += record.input;
			totals.output += record.output;
			totals.cacheRead += record.cacheRead;
			totals.cacheWrite += record.cacheWrite;
			totals.cost += recordCost(config, format, record);
		}
		return totals;
	};
}

/** One record's cost: the configured rate, or Pi's recorded value. */
function recordCost(config: ByteflyConfig, format: Intl.DateTimeFormat | null, record: UsageRecord): number {
	const rates = findRates(config.rates, record.provider, record.model);
	if (rates === undefined) return config.fallbackToRecordedCost ? record.recordedCost : 0;
	const cost = tokenCost(record, rates);
	// An undated record is never discounted: we cannot tell which tariff applied.
	if (format === null || record.at === null) return cost;
	return isPeak(config.peak, record.at, format) ? cost : cost * rates.offPeakMultiplier;
}
