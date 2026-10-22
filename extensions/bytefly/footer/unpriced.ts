/**
 * The one notice a CNY session posts when records had no rate.
 *
 * CNY mode has no fallback, so a model the table cannot price contributes no
 * cost at all; the footer's total is then smaller than the work done, with
 * nothing on screen saying why. This is the one sentence that says it, once per
 * session, and names the two honest fixes rather than picking one: switch to
 * `USD` (Pi's catalog is already per model, tiers included) or state yuan rates
 * under `price.rates`.
 *
 * Pure: the caller has the count, this shapes the answer. No figure is quoted,
 * because there is none to quote.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";

/** The notice naming what the total leaves out, and how to price it. */
export function unpricedNotice(count: number): NoticeMessage {
	const subject = count === 1 ? "1 record has" : `${count} records have`;
	return noticeMessage({
		content:
			`${subject} no CNY rate, so ${count === 1 ? "it is" : "they are"} not in this total. ` +
			"Switch `price.currency.code` to USD to use Pi's recorded cost, or add yuan `price.rates` entries.",
		details: {
			source: "bytefly",
			title: "Records with no CNY rate",
			severity: "info",
			items: [{ label: "records", detail: String(count) }],
		},
	});
}

/** The one-line body an OS notification carries. */
export function unpricedBody(count: number): string {
	return `${count} record${count === 1 ? "" : "s"} with no CNY rate · use USD or add price.rates`;
}
