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
import { fakeTheme, makeRecordingTheme } from "../../../test/helpers/fakes.ts";
import {
	assistantCall,
	fullSnapshot,
	usageOf,
	usdBudget,
	withRegisteredFooter,
} from "../../../test/helpers/fixtures/footer.ts";
import { budgetBody, budgetNotice, budgetState } from "./budget.ts";
import { CURRENCY_DEFAULTS } from "./price/config.ts";
import { costSegment, delegationSegment } from "./render/segments.ts";

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

	test("reads the child share as part of the total, not beside it", () => {
		const state = budgetState(5, 5.31, 5);
		expect(state.spent).toBe(5.31);
		expect(state.children).toBe(5);
		expect(state.exceeded).toBe(true);
	});

	test("clamps a child share wider than the total it is part of", () => {
		// Children past the whole can only come from a mispriced input: the lead asked for the
		// guard to say what it defends rather than read as dead code. A notice claiming $7 of
		// child runs inside a $5 spend would be the contradiction, so the share stops at the total.
		const state = budgetState(5, 5, 7);
		expect(state.children).toBe(5);
		expect(budgetNotice(state, CURRENCY_DEFAULTS.USD).content).toContain("$5.000 of $5, $5.000 of it child runs");
		expect(budgetState(5, Number.NaN, 7).children).toBe(0);
		expect(budgetState(5, 5, Number.NaN).children).toBe(0);
	});

	test("names the child share only when there is one", () => {
		const notice = budgetNotice(budgetState(5, 5.25, 0), CNY);
		expect(notice.content).toContain("¥5.25 of ¥5. This is a warning only");
		expect(notice.details.items).toEqual([
			{ label: "spent", detail: "¥5.25" },
			{ label: "budget", detail: "¥5" },
		]);
	});

	test("adds the child share to the notice as a third item and a clause", () => {
		const notice = budgetNotice(budgetState(5, 5.31, 5), CURRENCY_DEFAULTS.USD);
		expect(notice.content).toContain(
			"Session spend reached the configured budget: $5.310 of $5, $5.000 of it child runs.",
		);
		expect(notice.details.items).toEqual([
			{ label: "spent", detail: "$5.310" },
			{ label: "child runs", detail: "$5.000" },
			{ label: "budget", detail: "$5" },
		]);
		// The OS line is one line: the share is the notice's to explain, not the body's.
		expect(budgetBody(budgetState(5, 5.31, 5), CURRENCY_DEFAULTS.USD)).toBe("Session budget reached · $5.310 of $5");
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

/** A finished child run, priced from the dollars Pi recorded for it when no rate matches. */
function childRun(recordedCost: number): unknown {
	return {
		agent: "explorer",
		provider: "other",
		model: "unpriced",
		input: 10,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		recordedCost,
		at: null,
		exitCode: 0,
	};
}

const children = (cost: number) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost });

describe("the bar and the notice hold the same total", () => {
	test("draws the session's spend and its child runs as one figure against the ceiling", () => {
		const delegated = fullSnapshot({
			budget: 5,
			usage: usageOf({ cost: 0.31 }),
			delegation: { runs: 1, usage: children(5) },
		});

		expect(costSegment(delegated, fakeTheme)?.forms).toEqual(["$5.31/$5"]);
		// The condition the notice fires on, read from the same state: the two cannot disagree.
		const reached = makeRecordingTheme() as any;
		costSegment(delegated, reached);
		expect(reached.calls).toContainEqual(["warning", "$5.31/$5"]);
		// `↳` still names the child share, so the session's own cost is the subtraction.
		expect(delegationSegment(delegated, fakeTheme)?.forms[0]).toContain("$5.00");
	});

	test("shows the same total with no ceiling configured", () => {
		const delegated = fullSnapshot({ usage: usageOf({ cost: 0.31 }), delegation: { runs: 1, usage: children(5) } });

		expect(costSegment(delegated, fakeTheme)?.forms).toEqual(["$5.31"]);
	});

	test("appears when the session's own spend is zero and only children spent", () => {
		const delegated = fullSnapshot({ usage: usageOf(), delegation: { runs: 1, usage: children(5) } });

		expect(costSegment(delegated, fakeTheme)?.forms).toEqual(["$5.00"]);
	});
});

describe("a delegated session's ceiling", () => {
	test("a child run alone can cross it, and the notice names the share", async () => {
		await withRegisteredFooter(
			usdBudget(0.5),
			async (h) => {
				await h.start();
				h.render();
				await h.settle();
				expect(h.messages).toEqual([]);

				h.subagent(childRun(5));
				h.render();
				await h.settle();

				expect(h.messages).toHaveLength(1);
				const notice = h.messages[0]?.message;
				expect(notice.customType).toBe(NOTICE_TYPE);
				expect(notice.content).toContain("$5.100 of $0.5, $5.000 of it child runs");
				expect(h.bodies).toEqual(["Session budget reached · $5.100 of $0.5"]);
				// The bar draws the same figure, with the child share kept apart beside it.
				expect(h.render().join("\n")).toContain("$5.100/$0.5 · ↳ 1 · $5.000");
			},
			{ cost: 0.1 },
		);
	});

	test("a child run under the ceiling leaves the sentence alone", async () => {
		await withRegisteredFooter(
			usdBudget(5),
			async (h) => {
				await h.start();
				h.render();
				await h.settle();
				h.subagent(childRun(1));
				h.render();
				await h.settle();

				expect(h.messages).toEqual([]);
				expect(h.render().join("\n")).toContain("$1.600/$5 · ↳ 1 · $1.000");
			},
			{ cost: 0.6 },
		);
	});
});

describe("the warning re-arms", () => {
	test("a tree that drops the spend below the ceiling stays quiet, and the next crossing warns again", async () => {
		await withRegisteredFooter(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			expect(h.messages).toHaveLength(1);

			// A `/tree` back to a branch that spent nothing: under the ceiling, so the one
			// warning is armed again rather than spent for the session.
			h.setBranch([]);
			await h.tree();
			h.render();
			await h.settle();
			expect(h.messages).toHaveLength(1);

			h.setBranch([assistantCall(0.6)]);
			await h.tree();
			h.render();
			await h.settle();
			expect(h.messages).toHaveLength(2);
		});
	});

	test("the same spend across a tree still warns once", async () => {
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
});
