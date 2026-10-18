/**
 * Price-configuration types for the footer.
 *
 * These describe `bytefly.json` and the rate lookup only: currency, per-model
 * rates, and the peak schedule. The footer's own data model lives in
 * `../types.ts`.
 */

/** The two pricing algorithms, named by the currency they total. */
export type CurrencyCode = "CNY" | "USD";

/** How a cost is calculated and rendered. */
export interface Currency {
	/**
	 * Which algorithm totals the session: `CNY` prices matched records from
	 * `rates` and the peak schedule; `USD` totals Pi's recorded dollar cost and
	 * ignores `rates` and `peak`.
	 */
	code: CurrencyCode;
	/** Digits after the decimal point. The symbol follows from `code`. */
	decimals: number;
}

/** Per-million-token rates for one model, in yuan; used by the CNY algorithm. */
export interface ModelRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Multiplier applied outside every peak window; `1` means no discount. */
	offPeakMultiplier: number;
}

/** One peak window in local time, as minutes since midnight. */
export interface PeakWindow {
	/** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
	days: readonly number[];
	/** Inclusive start, in minutes since local midnight. */
	from: number;
	/** Exclusive end; a value `<= from` wraps past midnight. */
	to: number;
}

/** When a provider charges its peak rate. */
export interface PeakSchedule {
	/** IANA zone the windows are stated in. */
	timezone: string;
	/** No windows means every moment is peak, so a rate is flat. */
	windows: readonly PeakWindow[];
}

/** Everything the price calculation is configured with. */
export interface ByteflyConfig {
	currency: Currency;
	/** Rates keyed by `provider/model`, matched through wildcards. */
	rates: Readonly<Record<string, ModelRates>>;
	peak: PeakSchedule;
}
