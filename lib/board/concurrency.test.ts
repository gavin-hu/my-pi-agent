/**
 * Two writers, one board: the rules that need another card to answer, asked at the same time.
 *
 * These cases exist because a per-card write lock could not answer them. A mutation reads the
 * whole board to decide — has this lane a slot, would this link close a loop, does anything
 * still wait on this card — and two writers holding two different locks read two different
 * boards: `#1 dependsOn [2]` beside `#2 dependsOn [1]` closed a loop `wouldCycle` refuses for
 * one caller, and two claims each saw `plan: 2/3` and both entered. The lock is the board's
 * now, so the second writer reads what the first wrote; these two cases are what says so.
 *
 * The barrier is the seam `store.mutate` calls before it takes the lock, so both writers are
 * past every check and holding nothing when the gate opens — which is the arrangement that has
 * to resolve to one winner, and the one a test cannot otherwise reach into.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import type { MutateResult } from "./store.ts";
import { type Actor } from "./rules.ts";
import { createStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 10_000;
const ALICE: Actor = { id: "s-alice", label: "alice" };
const BOB: Actor = { id: "s-bob", label: "bob" };

/** A fresh board: the lock is one name inside one directory, so two cases share nothing. */
function board(): string {
	return temps.track(tempDir("pi-concurrency-"));
}

/**
 * A gate both writers stand at before either takes the lock, and the arm that closes it.
 *
 * `beforeWrite` runs before the lock is taken, so a call that reaches it holds nothing and has
 * checked nothing: opening the gate once both have arrived puts the two windows side by side.
 * It is armed after the board is seeded, because seeding is mutations too, and a retry after
 * the gate has opened is let straight through — which is why the count only equals the pair
 * once.
 */
function makeGate(writers: number): { arm: () => void; wait: () => Promise<void> } {
	let armed = false;
	let open = () => {};
	const reached = new Promise<void>((resolve) => {
		open = resolve;
	});
	let arrived = 0;
	return {
		arm: () => {
			armed = true;
		},
		wait: async () => {
			if (!armed) return;
			arrived += 1;
			if (arrived === writers) open();
			await reached;
		},
	};
}

/** The one writer that won, and the one sentence the other was refused with. */
function split(results: readonly MutateResult[]): { won: number; lost: string } {
	const won = results.filter((result) => result.ok).length;
	const refused = results.find((result) => !result.ok);
	const lost = refused === undefined || refused.ok ? "" : refused.error;
	return { won, lost };
}

describe("two writers at once", () => {
	test("cannot both pass the lane's limit", async () => {
		const dir = board();
		const gate = makeGate(2);
		const one = createStore(dir, { beforeWrite: gate.wait });
		const two = createStore(dir, { beforeWrite: gate.wait });
		await one.ensure();
		// Two cards already being planned, and the lane holds three: one slot, two claims.
		const planned = [await one.create({ title: "Planned one", paths: [] }, ALICE, NOW)];
		planned.push(await one.create({ title: "Planned two", paths: [] }, ALICE, NOW));
		for (const card of planned) await advance(one, card.id, "plan", { owner: ALICE }, NOW);
		const left = await one.create({ title: "Wanted one", paths: [] }, ALICE, NOW);
		const right = await one.create({ title: "Wanted two", paths: [] }, BOB, NOW);

		gate.arm();
		const results = await Promise.all([
			one.mutate(left.id, { kind: "claim" }, ALICE, NOW),
			two.mutate(right.id, { kind: "claim" }, BOB, NOW),
		]);

		// One slot, so one claim: the second reads the board the first wrote, not the board it
		// would have seen a moment earlier.
		const { won, lost } = split(results);
		expect(won).toBe(1);
		expect(lost).toContain("cannot enter plan");
		expect((await one.list()).filter((card) => card.lane === "plan")).toHaveLength(3);
	});

	test("cannot close a dependency loop between them", async () => {
		const dir = board();
		const gate = makeGate(2);
		const one = createStore(dir, { beforeWrite: gate.wait });
		const two = createStore(dir, { beforeWrite: gate.wait });
		await one.ensure();
		// Two sessions, one card each, both planned and both free to link.
		const left = await one.create({ title: "Left", paths: [] }, ALICE, NOW);
		const right = await one.create({ title: "Right", paths: [] }, BOB, NOW);
		await advance(one, left.id, "plan", { owner: ALICE }, NOW);
		await advance(one, right.id, "plan", { owner: BOB }, NOW);

		gate.arm();
		const results = await Promise.all([
			one.mutate(left.id, { kind: "edit", dependsOn: [right.id] }, ALICE, NOW),
			two.mutate(right.id, { kind: "edit", dependsOn: [left.id] }, BOB, NOW),
		]);

		// Whichever wrote first holds the edge; the second is refused for the loop it would close,
		// which is the sentence `wouldCycle` gives one caller.
		const { won, lost } = split(results);
		expect(won).toBe(1);
		expect(lost).toContain("that would make a loop");
		const edges = (await one.list()).flatMap((card) => (card.dependsOn ?? []).map((id) => `${card.id}>${id}`));
		expect(edges).toHaveLength(1);
	});
});
