import { describe, expect, test } from "bun:test";
import { CURRENCY_DEFAULTS } from "./price/config.ts";
import { budgetBody, budgetNotice, budgetState } from "./budget.ts";

const CNY = CURRENCY_DEFAULTS.CNY;

describe("budgetState", () => {
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
});

describe("budgetNotice", () => {
	const state = budgetState(5, 5.25);

	test("names both figures in the configured currency", () => {
		const notice = budgetNotice(state, CNY);

		expect(notice.content).toContain("¥5.25 of ¥5.00");
		expect(notice.details.items).toEqual([
			{ label: "spent", detail: "¥5.25" },
			{ label: "budget", detail: "¥5.00" },
		]);
	});

	test("is a warning, not a failure, and says the session continues", () => {
		const notice = budgetNotice(state, CNY);

		expect(notice.details.severity).toBe("warn");
		expect(notice.details.source).toBe("bytefly");
		expect(notice.details.title).toBe("Session budget reached");
		expect(notice.content).toContain("the session continues");
		expect(notice.content).toContain("price.budget");
	});

	test("follows the currency's precision", () => {
		const usd = budgetNotice(budgetState(2, 2.0004), CURRENCY_DEFAULTS.USD);

		expect(usd.content).toContain("$2.000 of $2.000");
	});

	test("shows a sub-minor-unit spend the way the footer does", () => {
		const notice = budgetNotice(budgetState(0.001, 0.001), CNY);

		expect(notice.content).toContain("¥<0.01 of ¥<0.01");
	});
});

describe("budgetBody", () => {
	test("is one line naming the figures", () => {
		expect(budgetBody(budgetState(5, 6), CNY)).toBe("Session budget reached · ¥6.00 of ¥5.00");
	});
});
