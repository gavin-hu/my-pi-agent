/**
 * The two `team` verbs that put a message on the bus: `assign` and `offer`.
 *
 * The order is the whole point — a message before an assignment, and a card untouched when
 * the message fails — so the cases drive a recording dispatch and assert both the calls made
 * and the card the store ends up with. The board's WIP limits are here because they are the
 * pre-check these two read before they send anything.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

describe("assign", () => {
	test("sends the handoff first, then records the owner", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core", note: "start with the webhook" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("billing-core");
		expect(sent[0]?.text).toContain("Note: start with the webhook");
		// The id comes from the bus, so a peer that renames itself still holds its card.
		// A handoff pulls a pool card into `plan`, where its contract is written.
		expect(result.details.card).toMatchObject({
			lane: "plan",
			owner: { id: "s-billing-core", label: "billing-core" },
		});
		expect(result.details.delivered).toEqual(["billing-core"]);
		expect(resultText(result)).toContain("#1 handed off to billing-core.");
		// Listening is the default the stub reports, so no warning line is added.
		expect(resultText(result)).not.toContain("Not listening");
	});

	test("names the peer when its record says it is not listening", async () => {
		const { call, seed } = harness({ peers: [{ id: "s-billing-core", label: "billing-core", listening: false }] });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(resultText(result)).toContain("Not listening: billing-core — it reads this at its next turn.");
		expect(result.details.notListening).toEqual(["billing-core"]);
	});

	test("names the peer it must be told about, and sends nothing without one", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "assign", card: id });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("assign needs a peer");
		expect(sent).toEqual([]);
	});

	test("refuses a card that does not exist, before sending anything", async () => {
		const { call, sent } = harness();
		const result = await call({ action: "assign", card: "9", to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("#9 does not exist.");
		expect(sent).toEqual([]);
	});

	test("refuses a finished card, before sending anything", async () => {
		const { call, seed, store, sent } = harness();
		const id = await seed();
		// Finish it through the gates, as two sessions would.
		await advance(await store(), id, "done", { owner: { label: "billing-core" } }, NOW);
		const result = await call({ action: "assign", card: id, to: "billing-other" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("is done");
		expect(sent).toEqual([]);
	});

	test("a send that fails leaves the card exactly as it was", async () => {
		const { call, seed, sent } = harness({ fail: "the bus is not loaded." });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("was not handed off to billing-core: the bus is not loaded.");
		expect(resultText(result)).toContain("The card is unchanged.");
		expect(sent).toEqual([]);
		expect(result.details.card).toMatchObject({ lane: "backlog" });
		expect(result.details.card?.owner).toBeUndefined();
	});

	test("refuses a handoff to the lead's own label or id, and names the claim", async () => {
		const { call, seed, store, sent, me } = harness();
		const id = await seed();
		const self = await me();
		// Both ways a caller can name itself: the label it writes cards as, and the id a
		// card records — a handoff through either door is the same act.
		const targets = [self.label, self.label.toUpperCase()];
		if (self.id !== undefined) targets.push(self.id);
		for (const to of targets) {
			const result = await call({ action: "assign", card: id, to });
			expect(result.isError, to).toBe(true);
			expect(resultText(result)).toContain(`#${id} cannot be handed to yourself: \`claim\` takes one.`);
		}
		// Nothing was mailed into the lead's own inbox, and the card never moved.
		expect(sent).toEqual([]);
		expect((await (await store()).read(id))?.owner).toBeUndefined();
	});

	test("takes the holder's id the way it takes its label: the card is its own and nothing is written", async () => {
		const { call, seed, store } = harness();
		const board = await store();
		// The bus knew the holder when the card was claimed, so the record carries the id a
		// rename keeps — which is what `holds` compares first.
		const withId = await seed();
		await board.mutate(withId, { kind: "claim" }, { id: "s-billing-core", label: "billing-core" }, NOW);
		// A card claimed before the bus could say records the label alone, and the id that
		// resolves to that label is still the same session.
		const byLabel = await seed("Second");
		await board.mutate(byLabel, { kind: "claim" }, { label: "billing-core" }, NOW);

		for (const id of [withId, byLabel]) {
			const before = await board.read(id);
			const result = await call({ action: "assign", card: id, to: "s-billing-core" });
			expect(result.isError, id).toBeFalsy();
			expect(result.details.card?.owner?.label, id).toBe("billing-core");
			// The holder is a no-op in the store, so the write is skipped and the revision holds:
			// the same answer the label gives, which is what naming the holder means.
			expect(result.details.card?.rev, id).toBe(before?.rev);
		}
	});
});

describe("offer", () => {
	test("broadcasts the card as an event, then records the offer and nothing else", async () => {
		const { call, seed, sent, store } = harness();
		const id = await seed();
		const before = await (await store()).read(id);
		const result = await call({ action: "offer", card: id, note: "whoever is free" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "event", to: "*" });
		expect(sent[0]?.text).toContain("is unclaimed");
		expect(sent[0]?.text).toContain("Note: whoever is free");
		// One write, and only the offer: the card is unowned, still to do, and its one
		// change is the moment it was offered — which is what a lead reads instead of
		// guessing whether anybody looked.
		const after = await (await store()).read(id);
		expect(after?.rev).toBe((before?.rev ?? 0) + 1);
		expect(after?.offeredAt).toBe(NOW);
		expect(after?.lane).toBe("backlog");
		expect(after?.owner).toBeUndefined();
		expect(result.details.card?.offeredAt).toBe(NOW);
		expect(resultText(result)).toContain("#1 offered to billing-core, billing-web.");
		expect(resultText(result)).toContain("unowned until one of them claims it");
	});

	test("a claim answers the offer, so the record goes with it", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "offer", card: id });
		expect((await (await store()).read(id))?.offeredAt).toBe(NOW);
		await (await store()).mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW + 1);
		// The next reader of the card cannot mistake an answered offer for an open one.
		expect((await (await store()).read(id))?.offeredAt).toBeUndefined();
	});

	test("refuses a card somebody holds, and one that waits, without broadcasting", async () => {
		const { call, seed, sent, store } = harness();
		const first = await seed("First");
		const board = await store();
		await board.mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const held = await call({ action: "offer", card: first });
		expect(held.isError).toBe(true);
		expect(resultText(held)).toContain("is held by billing-core");

		const second = await seed("Second");
		await board.mutate(
			second,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [first] },
			{ label: "billing-core" },
			NOW,
		);
		const waiting = await call({ action: "offer", card: second });
		expect(waiting.isError).toBe(true);
		expect(resultText(waiting)).toContain("waits on");
		expect(sent).toEqual([]);
	});

	test("reports a broadcast that reached nobody, and leaves the card alone", async () => {
		const { call, seed, store } = harness({ fail: "no other active sessions." });
		const id = await seed();
		const before = await (await store()).read(id);
		const result = await call({ action: "offer", card: id });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("#1 was not offered: no other active sessions.");
		expect(resultText(result)).toContain("The card is unchanged.");
		expect((await (await store()).read(id))?.rev).toBe(before?.rev);
	});

	test("names the peers it reached that are not listening", async () => {
		const peers = [
			{ id: "s-billing-core", label: "billing-core", listening: true },
			{ id: "s-billing-web", label: "billing-web", listening: false },
		];
		const { call, seed } = harness({ peers });
		const id = await seed();
		const result = await call({ action: "offer", card: id });
		expect(resultText(result)).toContain("Not listening: billing-web");
		expect(result.details.notListening).toEqual(["billing-web"]);
	});
});

describe("the board's WIP limits", () => {
	/** A harness whose project config caps `plan` at one card, written before the store opens. */
	function capped() {
		const board = harness();
		mkdirSync(join(board.cwd, ".pi"), { recursive: true });
		writeFileSync(join(board.cwd, ".pi", "bytefly.json"), JSON.stringify({ board: { wip: { plan: 1, execute: 1 } } }));
		return board;
	}

	test("a full plan lane refuses the handoff before anything is sent", async () => {
		const { call, seed, store, sent } = capped();
		const first = await seed("First");
		const second = await seed("Second");
		await (await store()).mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const refused = await call({ action: "assign", card: second, to: "billing-core" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain(`#${second} cannot enter plan`);
		expect(resultText(refused)).toContain("the limit is 1");
		expect(sent).toEqual([]);
	});

	test("a full plan lane refuses the offer, which is the claim it asks for", async () => {
		const { call, seed, store, sent } = capped();
		const first = await seed("First");
		const second = await seed("Second");
		await (await store()).mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const refused = await call({ action: "offer", card: second });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain(`#${second} cannot be offered`);
		expect(resultText(refused)).toContain("the limit is 1");
		expect(sent).toEqual([]);
	});

	test("a full plan lane refuses the lead's own claim, with the same sentence", async () => {
		const { call, seed, store } = capped();
		const first = await seed("First");
		const second = await seed("Second");
		await (await store()).mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const refused = await call({ action: "claim", card: second });
		expect(refused.isError).toBe(true);
		// The store's own refusal: the round adds no rule of its own to a claim.
		expect(resultText(refused)).toContain(`#${second} cannot enter plan`);
		expect(resultText(refused)).toContain("the limit is 1");
		expect((await (await store()).read(second))?.lane).toBe("backlog");
	});
});
