/**
 * The one notice a session posts when records had no rate.
 *
 * A record nothing priced contributes no cost at all — CNY has no fallback, and USD
 * falls back to Pi's recorded amount, which is `0` for a model its catalog does not
 * know — so the footer's total is smaller than the work done, with nothing on screen
 * saying why. This is the one sentence that says it, once per session, and it names the
 * models by the key that would price them rather than only counting records: a count
 * tells a reader the total is short, and a key tells them what to do about it.
 *
 * Two fixes are honest and the notice does not pick for the reader: switch to `USD`
 * (Pi's catalog is already per model, tiers included) or state yuan rates under
 * `price.rates`. No figure is quoted, because there is none to quote.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import type { UnpricedModel } from "./types.ts";

/** How many keys the notice and its OS body name before they count the rest. */
export const NAMED_MODELS = 3;

/** The keys to print, most records first, and how many were left out. */
function named(models: readonly UnpricedModel[]): string {
	const shown = models.slice(0, NAMED_MODELS).map((model) => model.key);
	const rest = models.length - shown.length;
	return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

/**
 * What a count of records reads as: `1 record`, `2 records`.
 *
 * Exported because the notice, its OS body, and `/bytefly prices` all say it, and three
 * wordings for one fact is how a report starts disagreeing with the message beside it.
 */
export function recordsText(count: number): string {
	return count === 1 ? "1 record" : `${count} records`;
}

/** The notice naming what the total leaves out, and how to price it. */
export function unpricedNotice(models: readonly UnpricedModel[]): NoticeMessage {
	const count = models.reduce((total, model) => total + model.records, 0);
	const subject = count === 1 ? "1 record has" : `${count} records have`;
	return noticeMessage({
		content:
			`${subject} no rate, so ${count === 1 ? "it is" : "they are"} not in this total: ${named(models)}. ` +
			"Switch `price.currency.code` to USD to use Pi's recorded cost, or add `price.rates` entries for those keys.",
		details: {
			source: "bytefly",
			title: "Records with no rate",
			severity: "info",
			items: models.slice(0, NAMED_MODELS).map((model) => ({ label: model.key, detail: recordsText(model.records) })),
		},
	});
}

/** The one-line body an OS notification carries: the first key is the actionable part. */
export function unpricedBody(models: readonly UnpricedModel[]): string {
	const count = models.reduce((total, model) => total + model.records, 0);
	const first = models[0]?.key ?? "";
	return `${recordsText(count)} with no rate · ${first} · use USD or add price.rates`;
}
