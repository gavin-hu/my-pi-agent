import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOTICE_TYPE } from "../../../lib/notice.ts";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { createFakePi, emit } from "../../../test/helpers/fakes.ts";
import { fakeFooterCtx, renderFooter } from "../../../test/helpers/fixtures/bytefly.ts";
import { registerFooter } from "./register.ts";

/** An assistant call that Pi recorded as costing `cost` dollars. */
function call(cost: number): unknown {
	return {
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: {
			role: "assistant",
			provider: "anthropic",
			model: "opus-4.5",
			usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
		},
	};
}

interface Harness {
	pi: any;
	ctx: any;
	footerData: any;
	footers: any[];
	messages: Array<{ message: any }>;
	bodies: string[];
	start(): Promise<void>;
	settle(): Promise<void>;
	/** Render the installed footer, which is what prices the session. */
	render(): void;
}

/**
 * Register the footer in `tui` mode over `bytefly.json` with a USD budget, so the
 * price comes straight from Pi's recorded dollars and the threshold is exact.
 */
async function scenario(
	price: Record<string, unknown> | undefined,
	fn: (h: Harness) => Promise<void>,
	cost = 0.6,
): Promise<void> {
	await withAgentDir(async (agentDir) => {
		if (price) writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ price }));
		const { pi } = createFakePi();
		const messages: Array<{ message: any }> = [];
		pi.sendMessage = (message: any) => messages.push({ message });
		const bodies: string[] = [];
		const { ctx, footerData, footers } = fakeFooterCtx({ mode: "tui", entries: [call(cost)] });

		registerFooter(pi, { notify: (body) => bodies.push(body) });

		await fn({
			pi,
			ctx,
			footerData,
			footers,
			messages,
			bodies,
			start: () => emit(pi, "session_start", { reason: "startup" }, ctx),
			settle: () => emit(pi, "agent_settled", { aborted: false }, ctx),
			render: () => renderFooter(footers.at(-1), footerData, 100),
		});
	});
}

/** `price` configured for dollars with the given budget. */
const usdBudget = (budget: number): Record<string, unknown> => ({ currency: { code: "USD" }, budget });

describe("registerFooter — session budget", () => {
	test("warns once, in the transcript and through notify, when the spend passes the budget", async () => {
		await scenario(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			const notice = h.messages[0]?.message;
			expect(notice.customType).toBe(NOTICE_TYPE);
			expect(notice.details.title).toBe("Session budget reached");
			expect(notice.details.severity).toBe("warn");
			expect(notice.content).toContain("$0.600 of $0.500");
			expect(h.bodies).toEqual(["Session budget reached · $0.600 of $0.500"]);
		});
	});

	test("stays silent on a later turn once it has warned", async () => {
		await scenario(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();
			await h.settle();

			expect(h.messages).toHaveLength(1);
			expect(h.bodies).toHaveLength(1);
		});
	});

	test("stays silent below the budget", async () => {
		await scenario(usdBudget(5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toEqual([]);
			expect(h.bodies).toEqual([]);
		});
	});

	test("is off when no budget is configured", async () => {
		await scenario(usdBudget(0), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			expect(h.messages).toEqual([]);
		});
	});

	test("does not repeat a warning when the session tree changes", async () => {
		await scenario(usdBudget(0.5), async (h) => {
			await h.start();
			h.render();
			await h.settle();

			// A tree change re-installs the footer; the spend did not move, so the
			// warning it already posted must not be posted again.
			await emit(h.pi, "session_tree", {}, h.ctx);
			h.render();
			await h.settle();

			expect(h.messages).toHaveLength(1);
		});
	});

	test("warns again in a new session", async () => {
		await scenario(usdBudget(0.5), async (h) => {
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
		await scenario(usdBudget(0.5), async (h) => {
			// A print-mode session installs no footer, so there is no priced spend to read.
			h.ctx.mode = "print";
			await h.start();
			await h.settle();

			expect(h.messages).toEqual([]);
		});
	});
});
