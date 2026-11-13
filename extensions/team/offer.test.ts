/**
 * The `team` verb that broadcasts a card: `offer`, and what its record adds to the event.
 *
 * Held apart from `handoff.test.ts` — the verb that sends a card to one peer and records the
 * owner — because an offer names nobody: the event is what a peer acts on, and the record only
 * says when it was made. The order is still the point, so the cases drive the same recording
 * dispatch and assert both the call made and the card the store ends up with.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, SUITE_LEAD, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

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
		// A claimer meets the same two gates, so the broadcast names them too.
		expect(sent[0]?.text).toContain(`needs the lead (${SUITE_LEAD}) to \`approve\` the contract`);
		expect(sent[0]?.text).toContain("`done` needs the lead's `review`");
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

	test("records the offer a peer could not be reached for, and names it", async () => {
		// One message file per inbox: the broadcast landed in one, not the other, so the offer
		// happened. Recording nothing would lose the record of an offer that reached somebody.
		const { call, seed, store } = harness({
			undelivered: [{ label: "billing-web", error: "EEXIST: file already exists, mkdir '…'" }],
		});
		const id = await seed();
		const result = await call({ action: "offer", card: id });
		expect(result.isError).toBeFalsy();
		expect(resultText(result)).toContain("#1 offered to billing-core.");
		expect(resultText(result)).toContain("Not delivered to billing-web (EEXIST: file already exists, mkdir '…').");
		expect(result.details.failed?.map((entry) => entry.label)).toEqual(["billing-web"]);
		expect((await (await store()).read(id))?.offeredAt).toBe(NOW);
	});

	test("a record that throws after the broadcast says who heard, and sends no correction", async () => {
		// The peers have the event; the store threw on the record that follows it. The lead is
		// told both halves, because a re-offer is the move a bare reason invites and it wakes
		// every peer again.
		const broken = harness({ failWrite: "EPERM: operation not permitted, rename 'cards/0001.json'" });
		const id = await broken.seed();
		const result = await broken.call({ action: "offer", card: id });

		expect(broken.sent).toHaveLength(1);
		expect(broken.sent[0]?.to).toBe("*");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			`#${id} was offered, but recording the offer failed: EPERM: operation not permitted`,
		);
		expect(resultText(result)).toContain("read the card with `board` action `list` before offering it again");
		expect(result.details.delivered).toEqual(["billing-core", "billing-web"]);
		expect(result.details.card).toMatchObject({ lane: "backlog", id });
		// Nothing recorded an offer that never landed, so the board's card carries no timestamp.
		expect((await (await broken.store()).read(id))?.offeredAt).toBeUndefined();
	});

	test("an offer whose record loses the race sends no correction, and the claim is what tells a peer", async () => {
		let id = "";
		const race = harness({
			duringSend: async () => {
				const claimed = await (await race.store()).mutate(id, { kind: "claim" }, { label: "billing-web" }, NOW + 1);
				expect(claimed.ok).toBe(true);
			},
		});
		id = await race.seed();
		const result = await race.call({ action: "offer", card: id });

		// One broadcast and nothing after it: the offer's only next step is a claim, and the store
		// refuses that naming the holder — so a stale offer cannot send a peer anywhere it is not
		// told, and a second message would only wake every peer again.
		expect(race.sent).toHaveLength(1);
		expect(race.sent[0]?.to).toBe("*");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("was offered, but recording the offer was refused");
		expect(result.details.card).toMatchObject({ owner: { label: "billing-web" } });

		const late = await (await race.store()).mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW + 2);
		if (late.ok) throw new Error("a card somebody holds is not claimable");
		expect(late.error).toContain("is held by billing-web");
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
