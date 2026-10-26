/**
 * The `/bytefly prices` report: which models this session could not price.
 *
 * A record nothing priced contributes no cost, so the footer's total is smaller than
 * the work done and the reason is a *model*, not a record count. This is the answer to
 * the question the footer can only hint at: the keys, in the `price.rates` vocabulary,
 * and the one line saying what to do with them.
 *
 * Nothing here quotes a price: a rate is the user's to state, and inventing one is the
 * rate table this command exists instead of.
 */

import { sanitizeLine } from "../../../lib/format.ts";
import type { PricedUsage } from "../footer/types.ts";
import { formatCost } from "../footer/render/format.ts";
import { recordsText } from "../footer/unpriced.ts";
import type { Currency } from "../footer/price/types.ts";

/** How many keys the report prints before it counts the rest. */
export const REPORTED_MODELS = 8;

/**
 * The report as the lines a reader gets.
 *
 * The headline says what the total is and how much of the session it leaves out; one
 * line per key says what to add; the last line says where to add it. Pure: the caller
 * has already priced the session.
 */
export function pricesReport(priced: PricedUsage, currency: Currency): string[] {
	const models = priced.unpricedModels;
	if (models.length === 0) return ["bytefly: every record in this session has a rate — nothing to add."];
	const count = models.reduce((total, model) => total + model.records, 0);
	const headline =
		`bytefly: ${formatCost(priced.cost, currency)} priced · ` +
		`${recordsText(count)} in ${models.length === 1 ? "1 model" : `${models.length} models`} ${count === 1 ? "has" : "have"} no rate`;
	const keys = models
		.slice(0, REPORTED_MODELS)
		.map((model) => `  ${sanitizeLine(model.key)} · ${recordsText(model.records)}`);
	const rest = models.length - keys.length;
	if (rest > 0) keys.push(`  +${rest} more`);
	keys.push('  add these under "price.rates" in bytefly.json — a key may be `*`, or a prefix like `gpt-*`.');
	return [headline, ...keys];
}
