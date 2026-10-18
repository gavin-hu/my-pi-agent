/**
 * The session spend guardrail: one warning when the session's cost reaches the
 * configured budget.
 *
 * A budget is an alert, not a limit. Nothing is blocked or aborted — a hard stop
 * loses work, and the footer already shows the running cost — so this decides only
 * whether the threshold has been crossed and what the one notice says.
 *
 * Pure: the caller has the priced spend and the currency, this shapes the answer.
 * The amount formatting reuses the footer's own `formatCost`, so the notice and the
 * status bar cannot disagree about precision or about a sub-minor-unit amount.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { formatCost } from "./render/format.ts";
import type { Currency } from "./price/types.ts";

/** Where the session stands against its budget. */
export interface BudgetState {
	/** The configured budget, in `currency`; `0` means the guardrail is off. */
	limit: number;
	/** What the session has spent so far, in `currency`. */
	spent: number;
	/** Whether the budget is on and has been reached. Inclusive: exactly `limit` counts. */
	exceeded: boolean;
}

/** The session's position against its budget. */
export function budgetState(limit: number, spent: number): BudgetState {
	const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
	const safeSpent = Number.isFinite(spent) && spent > 0 ? spent : 0;
	return { limit: safeLimit, spent: safeSpent, exceeded: safeLimit > 0 && safeSpent >= safeLimit };
}

/**
 * The one notice a crossing posts.
 *
 * `warn` rather than `bad`: nothing failed, and nothing will be stopped. The
 * content names the figures so the model reads the same sentence the user does,
 * and says plainly that the session keeps running.
 */
export function budgetNotice(state: BudgetState, currency: Currency): NoticeMessage {
	const spent = formatCost(state.spent, currency);
	const limit = formatCost(state.limit, currency);
	return noticeMessage({
		content:
			`Session spend reached the configured budget: ${spent} of ${limit}. ` +
			"This is a warning only — the session continues; raise or clear `price.budget` to silence it.",
		details: {
			source: "bytefly",
			title: "Session budget reached",
			severity: "warn",
			items: [
				{ label: "spent", detail: spent },
				{ label: "budget", detail: limit },
			],
		},
	});
}

/** The one-line body an OS notification carries. */
export function budgetBody(state: BudgetState, currency: Currency): string {
	return `Session budget reached · ${formatCost(state.spent, currency)} of ${formatCost(state.limit, currency)}`;
}
