/**
 * The per-session cap as a gate: one card in flight, and the two doors that take one.
 *
 * The lane caps answer "how much work may this repository carry"; this answers "how much may one
 * session carry", and it is the rule the workflow was running on as a habit. What the cases pin is
 * the two doors (`claim` and `assign`), the three lanes that count (`plan`, `execute`, `blocked`),
 * the release that frees the slot, and the fact that a full *lane* and a full *session* refuse with
 * different sentences — a reader has to know which cap they hit.
 *
 * `limits.test.ts` holds the sentence and the arithmetic; this is the wiring through the store.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { boardConfig } from "./config.ts";
import { DEFAULT_WIP } from "./limits.ts";
import type { Actor } from "./rules.ts";
import { createStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 10_000;
const CORE: Actor = { id: "s-core", label: "billing-core" };
const OTHER: Actor = { id: "s-other", label: "billing-other" };

/** A board with the defaults, or the two caps a case varies. */
function board(wip: Partial<typeof DEFAULT_WIP> = {}) {
	const dir = temps.track(tempDir("pi-one-card-"));
	return createStore(dir, { config: boardConfig({ wip: { ...DEFAULT_WIP, ...wip } }) });
}

/** `count` pool cards, as the ids a case claims in order. */
async function seed(store: ReturnType<typeof board>, count: number): Promise<string[]> {
	const ids: string[] = [];
	for (let index = 0; index < count; index++)
		ids.push((await store.create({ title: `One ${index}`, paths: [] }, CORE, NOW)).id);
	return ids;
}

describe("one card in flight", () => {
	test("a claim is refused while the session holds a card, and the card is untouched", async () => {
		const store = board();
		const [first, second] = await seed(store, 2);
		expect(await store.mutate(first, { kind: "claim" }, CORE, NOW)).toMatchObject({ ok: true });

		const refused = await store.mutate(second, { kind: "claim" }, CORE, NOW);
		expect(refused).toMatchObject({
			ok: false,
			error: `billing-core already holds #${first} (plan): finish it, or release it to the pool first.`,
		});
		// A refusal half-applies nothing: the second card is still nobody's, in the pool.
		const untouched = await store.read(second);
		expect(untouched?.lane).toBe("backlog");
		expect(untouched?.owner).toBeUndefined();
		expect((await store.read(first))?.owner?.label).toBe("billing-core");
	});

	test("releasing the held card frees the slot", async () => {
		const store = board();
		const [first, second] = await seed(store, 2);
		await store.mutate(first, { kind: "claim" }, CORE, NOW);
		expect((await store.mutate(first, { kind: "release" }, CORE, NOW)).ok).toBe(true);
		expect((await store.mutate(second, { kind: "claim" }, CORE, NOW)).ok).toBe(true);
	});

	test("an assignment to a session at its cap is refused, and the card is untouched", async () => {
		const store = board();
		const [held] = await seed(store, 1);
		await store.mutate(held, { kind: "claim" }, OTHER, NOW);
		const [spare] = await seed(store, 1);

		const refused = await store.mutate(spare, { kind: "assign", to: { id: OTHER.id, label: OTHER.label } }, CORE, NOW);
		expect(refused).toMatchObject({
			ok: false,
			error: `billing-other already holds #${held} (plan): finish it, or release it to the pool first.`,
		});
		expect((await store.read(spare))?.owner).toBeUndefined();
	});

	test("a blocked card still counts: it is still the session's work", async () => {
		const store = board();
		const [first, second] = await seed(store, 2);
		await store.mutate(first, { kind: "claim" }, CORE, NOW);
		expect(
			(
				await store.mutate(
					first,
					{ kind: "move", lane: "blocked", blocker: "decision", blockedBy: "waiting" },
					CORE,
					NOW,
				)
			).ok,
		).toBe(true);

		expect(await store.mutate(second, { kind: "claim" }, CORE, NOW)).toMatchObject({
			ok: false,
			error: `billing-core already holds #${first} (blocked): finish it, or release it to the pool first.`,
		});
	});

	test("the lane cap and the session cap each name themselves", async () => {
		// The lane is full and this session holds nothing: the lane's sentence names the count.
		const laneFull = board({ plan: 1, perOwner: 5 });
		const [first, second] = await seed(laneFull, 2);
		await laneFull.mutate(first, { kind: "claim" }, OTHER, NOW);
		const laneRefusal = await laneFull.mutate(second, { kind: "claim" }, CORE, NOW);
		expect(laneRefusal.ok).toBe(false);
		// The lane's sentence, not the session's: this reader has to know which cap they hit.
		expect("error" in laneRefusal ? laneRefusal.error : "").toContain(
			"cannot enter plan: 1 cards are already being planned (the limit is 1)",
		);

		// The session is full and the lane has room: the session's sentence names the card.
		const sessionFull = board({ plan: 5, perOwner: 1 });
		const [mine, next] = await seed(sessionFull, 2);
		await sessionFull.mutate(mine, { kind: "claim" }, CORE, NOW);
		expect(await sessionFull.mutate(next, { kind: "claim" }, CORE, NOW)).toMatchObject({
			ok: false,
			error: `billing-core already holds #${mine} (plan): finish it, or release it to the pool first.`,
		});
	});

	test("a session may hold as many as the setting says, and no more", async () => {
		const store = board({ perOwner: 2 });
		const [first, second, third] = await seed(store, 3);
		expect((await store.mutate(first, { kind: "claim" }, CORE, NOW)).ok).toBe(true);
		expect((await store.mutate(second, { kind: "claim" }, CORE, NOW)).ok).toBe(true);
		expect(await store.mutate(third, { kind: "claim" }, CORE, NOW)).toMatchObject({
			ok: false,
			error: `billing-core already holds #${first} (plan) and 1 more: finish it, or release it to the pool first.`,
		});
	});

	test("the cap is one session's: two sessions each hold one", async () => {
		const store = board();
		const [first, second] = await seed(store, 2);
		expect((await store.mutate(first, { kind: "claim" }, CORE, NOW)).ok).toBe(true);
		expect((await store.mutate(second, { kind: "claim" }, OTHER, NOW)).ok).toBe(true);
	});
});
