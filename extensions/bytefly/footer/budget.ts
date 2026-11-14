/**
 * The session spend guardrail: one warning when the session's cost reaches the
 * configured budget.
 *
 * A budget is an alert, not a limit. Nothing is blocked or aborted — a hard stop
 * loses work, and the footer already shows the running cost — so this decides only
 * whether the threshold has been crossed and what the one notice says.
 *
 * The ceiling holds the session's spend and the child runs the ledger still holds — its
 * last 500, `MAX_DELEGATION_RECORDS`: a session that delegated $5 behind a $5 budget has
 * spent $5, and the bar's `↳` keeps naming the child share so a reader can subtract it.
 *
 * Pure: the caller has the priced spend and the currency, this shapes the answer.
 * The amount formatting is the footer's own — `formatCost` for what was spent,
 * `formatLimit` for the ceiling it is held against — so the notice and the status
 * bar cannot disagree about either figure.
 */

import { noticeMessage, type NoticeMessage } from "../../../lib/notice.ts";
import { formatCost, formatLimit } from "./render/format.ts";
import type { Currency } from "./price/types.ts";

/** Where the session stands against its budget. */
export interface BudgetState {
	/** The configured budget, in `currency`; `0` means the guardrail is off. */
	limit: number;
	/** What the session has spent so far, in `currency`, child runs included. */
	spent: number;
	/** How much of `spent` is child runs, in `currency`: the share `↳` draws. */
	children: number;
	/** Whether the budget is on and has been reached. Inclusive: exactly `limit` counts. */
	exceeded: boolean;
}

/**
 * The session's position against its budget.
 *
 * `spent` is the total the caller summed, so `children` is a share of a number that
 * already holds it — and a share wider than its whole can only come from a mispriced
 * input, which the clamp keeps from reaching the notice as a contradiction.
 */
export function budgetState(limit: number, spent: number, children = 0): BudgetState {
	const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
	const safeSpent = Number.isFinite(spent) && spent > 0 ? spent : 0;
	const safeChildren = Number.isFinite(children) && children > 0 ? Math.min(children, safeSpent) : 0;
	return {
		limit: safeLimit,
		spent: safeSpent,
		children: safeChildren,
		exceeded: safeLimit > 0 && safeSpent >= safeLimit,
	};
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
	const limit = formatLimit(state.limit, currency);
	const children = formatCost(state.children, currency);
	// The child share is a clause rather than a second sentence: the reader acts on the total
	// crossing the ceiling, and `↳` is where the detail lives when no ceiling is configured.
	const share = state.children > 0 ? `, ${children} of it child runs` : "";
	return noticeMessage({
		content:
			`Session spend reached the configured budget: ${spent} of ${limit}${share}. ` +
			"This is a warning only — the session continues; raise or clear `price.budget` to silence it.",
		details: {
			source: "bytefly",
			title: "Session budget reached",
			severity: "warn",
			items: [
				{ label: "spent", detail: spent },
				...(state.children > 0 ? [{ label: "child runs", detail: children }] : []),
				{ label: "budget", detail: limit },
			],
		},
	});
}

/** The one-line body an OS notification carries. */
export function budgetBody(state: BudgetState, currency: Currency): string {
	return `Session budget reached · ${formatCost(state.spent, currency)} of ${formatLimit(state.limit, currency)}`;
}
