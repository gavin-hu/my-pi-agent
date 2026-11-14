/**
 * The session budget guardrail: the pure position, the one notice, and what a settle does.
 *
 * Split from `footer.test.ts` because that suite is pinned at its height and the guardrail's
 * cases are a capability of their own — the ceiling is a number two surfaces read, and the
 * warning is state the extension keeps rather than anything a frame derives.
 *
 * The bar's half of the same decision (the `spent/limit` form and its `warn` colour) is
 * asserted here too, from the same `budgetState` the notice fires on, so the two cannot drift.
 */

import { describe, expect, test } from "bun:test";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { usdBudget, withRegisteredFooter } from "../../../test/helpers/fixtures/footer.ts";
import { budgetBody, budgetNotice, budgetState } from "./budget.ts";
import { CURRENCY_DEFAULTS } from "./price/config.ts";

describe("budget", () => {
	const CNY = CURRENCY_DEFAULTS.CNY;

	test("treats the threshold as inclusive", () => {
		expect(budgetState(5, 4.99).exceeded).toBe(false);
		expect(budgetState(5, 5).exceeded).toBe(true);
		expect(budgetState(5, 6).exceeded).toBe(true);
	});

	test("is off when the budget is zero, negative, or not a number", () => {
		for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(budgetState(limit, 1_000).exceeded).toBe(false);
			expect(budgetState(limit, 1_000).limit).toBe(0);
		}
	});

	test("treats a missing or negative spend as zero", () => {
		expect(budgetState(5, Number.NaN).spent).toBe(0);
		expect(budgetState(5, -2).spent).toBe(0);
		expect(budgetState(5, -2).exceeded).toBe(false);
	});

	test("names both figures in the configured currency", () => {
		const notice = budgetNotice(budgetState(5, 5.25), CNY);

		expect(notice.content).toContain("¥5.25 of ¥5");
		expect(notice.details.items).toEqual([
			{ label: "spent", detail: "¥5.25" },
			{ label: "budget", detail: "¥5" },
		]);
	});

	test("is a warning, not a failure, and says the session continues", () => {
		const notice = budgetNotice(budgetState(5, 5.25), CNY);

		expect(notice.details.severity).toBe("warn");
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("Session budget reached");
		expect(notice.content).toContain("the session continues");
		expect(notice.content).toContain("price.budget");
	});

	test("follows the currency's precision and shows a sub-minor-unit spend", () => {
		expect(budgetNotice(budgetState(2, 2.0004), CURRENCY_DEFAULTS.USD).content).toContain("$2.000 of $2");
		expect(budgetNotice(budgetState(0.001, 0.001), CNY).content).toContain("¥<0.01 of ¥<0.01");
	});

	test("keeps a ceiling's cents but drops its trailing zeros", () => {
		expect(budgetBody(budgetState(5, 6), CNY)).toBe("Session budget reached · ¥6.00 of ¥5");
		expect(budgetBody(budgetState(7.5, 8), CNY)).toBe("Session budget reached · ¥8.00 of ¥7.5");
	});

	test("is one body line naming the figures", () => {
		expect(budgetBody(budgetState(5, 6), CNY)).toBe("Session budget reached · ¥6.00 of ¥5");
	});
});

describe("registerFooter session budget", () => {
	test("warns once, in the transcript and through notify, when the spend passes the budget", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			const notice = h.messages[0]?.message;
			expect(notice.customType).toBe(NOTICE_TYPE);
			expect(notice.details.title).toBe("Session budget reached");
			expect(notice.details.severity).toBe("warn");
			expect(notice.content).toContain("$0.600 of $0.5");
			expect(h.bodies).toEqual(["Session budget reached · $0.600 of $0.5"]);
		});
	});

	test("stays silent on a later turn once it has warned", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			expect(h.bodies).toHaveLength(1);
		});
	});

	test("stays silent below the budget and when no budget is configured", async () => {
		await withRegisteredFooter(usdBudget(5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toEqual([]);
			expect(h.bodies).toEqual([]);
		});

		await withRegisteredFooter(usdBudget(0), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});

	test("does not repeat a warning when the session tree changes", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			await h.tree();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
		});
	});

	test("warns again in a new session", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(2);
		});
	});

	test("checks nothing outside the interactive mode", async () => {
		await withRegisteredFooter(
			usdBudget(0.5),
			async (h) => {
				await h.start();
				await h.settle();
				expect(h.messages).toEqual([]);
			},
			{ mode: "print" },
		);
	});

	test("checks nothing before a frame has priced the session", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			await h.settle();
			expect(h.messages).toEqual([]);
		});
	});
});
