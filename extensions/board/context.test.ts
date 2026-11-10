/**
 * The first-turn line: the cards this session holds, and what each owes next.
 *
 * The builder's cases read like the message: nothing for a session holding nothing, one bullet
 * per card from the page's own reason rule, and a cap that keeps the line a context budget
 * rather than a listing. The last cases go through the factory, because "once, and only when it
 * changed" is a fact about the handlers rather than about the sentence.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { pageWithNoRecording } from "../../test/helpers/board-command.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { billingCard, numberedCard } from "../../test/helpers/fixtures/board.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import type { Card } from "../../lib/board/card.ts";
import type { ClaimPathsResult, ReleasePathsResult } from "../../lib/session-tool.ts";
import type { Claims } from "./claims.ts";
import {
	BOARD_CONTEXT_MARKER,
	BOARD_CONTEXT_TYPE,
	buildBoardContext,
	MAX_CONTEXT_CARDS,
	MAX_CONTEXT_CHARS,
	MAX_BULLET_CHARS,
	heldCards,
	isBoardContext,
} from "./context.ts";
import board from "./index.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;
const LEAD = "board-lead";
const ENABLED = { [ENV_DISABLED_EXTENSIONS]: "" };

/** A card in one lane, as the line reads it. */
function inLane(lane: Card["lane"], overrides: Partial<Card> = {}): Card {
	const owner = lane === "backlog" ? undefined : { id: "s-1", label: "api-core" };
	// A lane somebody works in has a plan recorded; only the pool has no artifact to name.
	const planPath = lane === "backlog" ? undefined : "plans/one.md";
	return billingCard({ lane, owner, planPath, ...overrides });
}

/** The bus claims the factory's handler is given: recording, and loading on demand. */
function claims(): Claims & { sent: string[] } {
	const sent: string[] = [];
	return {
		sent,
		loaded: () => true,
		claim: async (_ctx, paths): Promise<ClaimPathsResult> => {
			sent.push(...paths);
			return { ok: true, claimed: [...paths], conflicts: [] };
		},
		release: async (_ctx, paths): Promise<ReleasePathsResult> => {
			sent.push(...paths);
			return { ok: true, released: [...paths], notOwned: [] };
		},
	};
}

describe("the line", () => {
	test("is nothing at all for a session holding nothing", () => {
		expect(buildBoardContext([])).toBeUndefined();
	});

	test("names each card, its lane, and the next thing it owes", () => {
		expect(buildBoardContext([inLane("execute")])).toBe(
			`${BOARD_CONTEXT_MARKER} 1 card is yours:\n- #4 (execute) executing — no spot-check yet`,
		);
		// The plan's sentence is the page's, from `reason.ts`: a missing contract names its lines.
		expect(buildBoardContext([inLane("plan", { contract: undefined })])).toContain(
			"- #4 (plan) no contract yet — missing goal, acceptance, scopeOut",
		);
	});

	test("caps at three cards, counts the rest, and stays inside its budget", () => {
		const many = [1, 2, 3, 4, 5].map((n) => numberedCard(String(n), { lane: "plan", owner: { label: "api-core" } }));
		const line = buildBoardContext(many);
		expect(line).toContain("- and 2 more");
		expect(line?.split("\n").length).toBe(MAX_CONTEXT_CARDS + 2);
		expect(line?.length ?? 0).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
		expect(line).toContain("5 cards are yours");
	});

	test("spends its budget on whole bullets, never on a slice of one", () => {
		// A `blocked` note is up to 200 characters, so its bullet is longer than any one line may
		// be: it is clipped with an ellipsis rather than cut off by the message's own ceiling.
		const longest =
			"waiting on the API owner to confirm the retry cap and the idempotency key for billing, plus the " +
			"error taxonomy the finance team signed off on, and whether a retried order keeps its original id";
		const one = buildBoardContext([inLane("blocked", { blocked: { kind: "decision", note: longest } })]) ?? "";
		expect(one.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
		const clipped = one.split("\n")[1] ?? "";
		expect(clipped.length).toBeLessThanOrEqual(MAX_BULLET_CHARS);
		expect(clipped.endsWith("…")).toBe(true);

		// Three notes that each fit on their own: the third is counted rather than half-written.
		const held = [1, 2, 3].map((n) =>
			inLane("blocked", { id: String(n), blocked: { kind: "decision", note: `${n}: ${longest.slice(0, 90)}` } }),
		);
		const line = buildBoardContext(held) ?? "";
		expect(line.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
		expect(line.split("\n").at(-1)).toMatch(/^- and \d+ more$/);
		for (const bullet of line.split("\n").slice(1, -1)) expect(bullet.endsWith("…")).toBe(false);
	});

	test("is recognized by its custom type, and only that", () => {
		expect(isBoardContext({ customType: BOARD_CONTEXT_TYPE })).toBe(true);
		expect(isBoardContext({ customType: "goal-context" })).toBe(false);
		expect(isBoardContext(undefined)).toBe(false);
	});
});

describe("heldCards", () => {
	test("is this session's unfinished cards, in lane order", async () => {
		const harness = boardHarness({ now: NOW, track: temps.track });
		const store = await harness.runtime.store(harness.ctx.cwd);
		const mine = { id: "s-lead", label: "billing-lead" };
		const peer = { id: "s-peer", label: "api-core" };
		await store.create({ title: "Executing", paths: [] }, mine, NOW);
		await store.mutate("1", { kind: "claim" }, mine, NOW);
		await store.create({ title: "Peers", paths: [] }, peer, NOW);
		await store.mutate("2", { kind: "claim" }, peer, NOW);
		// A finished card of this session's is history rather than work it still owes.
		await store.create({ title: "Finished", paths: [] }, mine, NOW);
		await store.mutate("3", { kind: "claim" }, mine, NOW);
		const done = await store.mutate("3", { kind: "move", lane: "blocked", blocker: "decision" }, mine, NOW);
		expect(done.ok).toBe(true);
		const { cards, skipped } = await store.scan();
		expect(skipped).toEqual([]);
		expect(cards).toHaveLength(3);
		const held = await heldCards(harness.runtime, harness.ctx);
		expect(held?.map((card) => card.id)).toEqual(["1", "3"]);
	});

	test("is nothing when the board cannot be read, rather than a failed turn", async () => {
		const { ctx } = fakeCtx();
		const session = {
			who: async () => ({ id: "s-lead", label: "billing-lead" }),
			store: async () => {
				throw new Error("the board directory is gone");
			},
		};
		expect(await heldCards(session as never, ctx)).toBeUndefined();
	});
});

describe("the factory's turn", () => {
	test("injects one line before the first turn, and not a second while it holds", async () => {
		await withEnv(ENABLED, async () => {
			const harness = boardHarness({ now: NOW, lead: LEAD, track: temps.track });
			const bus = claims();
			board(harness.fake.pi, { session: harness.runtime, page: pageWithNoRecording(), claims: bus });
			const tool = harness.fake.pi.tools.get("board");
			if (!tool) throw new Error("the board tool was not registered");
			const call = (args: Record<string, unknown>) => tool.execute("call-1", args, undefined, undefined, harness.ctx);
			await call({ action: "add", title: "One", paths: ["src/api"] });
			await call({ action: "claim", card: "1" });
			const starters = harness.fake.handlers.get("before_agent_start") ?? [];
			expect(starters).toHaveLength(1);
			const first = (await starters[0]?.({}, harness.ctx)) as
				| { message: { customType: string; content: string; display?: boolean } }
				| undefined;
			expect(first?.message.customType).toBe(BOARD_CONTEXT_TYPE);
			expect(first?.message.content).toContain("#1 (plan)");
			expect(first?.message.display).toBe(false);
			// The same board, on the next turn: the transcript already has the line — and a card
			// claimed afterwards does not earn a second read or a second line, because the claim's
			// own result already named the next step.
			expect(await starters[0]?.({}, harness.ctx)).toBeUndefined();
			await call({ action: "add", title: "Two", paths: [] });
			await call({ action: "claim", card: "2" });
			expect(await starters[0]?.({}, harness.ctx)).toBeUndefined();
		});
	});

	test("keeps only the newest injected line, so a resume cannot stack them", async () => {
		const contexts = [
			{ customType: "board-context", content: "old" },
			{ customType: "user", content: "hi" },
			{ customType: "board-context", content: "new" },
		];
		const pruners = (() => {
			const fake = boardHarness({ now: NOW, track: temps.track });
			board(fake.fake.pi, { session: fake.runtime, page: pageWithNoRecording(), claims: claims() });
			return fake.fake.handlers.get("context") ?? [];
		})();
		const answer = (await pruners[0]?.({ messages: contexts }, fakeCtx().ctx)) as
			| { messages: Array<{ content: string }> }
			| undefined;
		expect(answer?.messages.map((message) => message.content)).toEqual(["hi", "new"]);
	});
});
