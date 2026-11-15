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

	test("records the offer, then reports a broadcast that reached nobody", async () => {
		const { call, seed, store } = harness({ fail: "no other active sessions." });
		const id = await seed();
		const result = await call({ action: "offer", card: id });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			`#${id} is offered and recorded, but the broadcast did not reach anybody: no other active sessions.`,
		);
		expect(resultText(result)).toContain("Offer it again to retry");
		// The record is the moment; the message is what nobody heard, and a repeat re-sends it keyed.
		expect((await (await store()).read(id))?.offeredAt).toBe(NOW);
	});

	test("a broadcast whose every inbox refused is a recorded offer nobody heard", async () => {
		const { call, seed, store } = harness({
			undelivered: [
				{ label: "billing-core", error: "EEXIST: file already exists" },
				{ label: "billing-web", error: "EEXIST: file already exists" },
			],
		});
		const id = await seed();
		const result = await call({ action: "offer", card: id });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("the broadcast did not reach anybody");
		expect(resultText(result)).toContain("Billing-core".toLowerCase());
		expect((await (await store()).read(id))?.offeredAt).toBe(NOW);
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

	test("a record that throws sends no broadcast", async () => {
		const broken = harness({ failWrite: "EPERM: operation not permitted, rename 'cards/0001.json'" });
		const id = await broken.seed();
		const result = await broken.call({ action: "offer", card: id });

		// State first: a record that cannot land is an offer that was never made, so no peer is woken.
		expect(broken.sent).toEqual([]);
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(`#${id} was not offered: EPERM: operation not permitted`);
		expect(resultText(result)).toContain("The card is unchanged.");
		expect((await (await broken.store()).read(id))?.offeredAt).toBeUndefined();
	});

	test("a record the store refuses sends no broadcast", async () => {
		const race = harness();
		const id = await race.seed();
		await (await race.store()).mutate(id, { kind: "claim" }, { label: "billing-web" }, NOW + 1);
		const result = await race.call({ action: "offer", card: id });

		expect(race.sent).toEqual([]);
		expect(result.isError).toBe(true);
		// The precheck refuses it before the write, which is the cheapest place to refuse: no record
		// and no broadcast.
		expect(resultText(result)).toContain("is held by billing-web");
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
