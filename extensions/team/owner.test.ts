/**
 * The owner a handoff records: what the card says about the session it was given to.
 *
 * Split from `handoff.test.ts`, which is at its line budget: the order a handoff pays — a join, a
 * message, a write — is one question, and which session the card then names is another. The second
 * is the one with a `told` fact, an `unresolved` mark, and a roster read that can move under the
 * verb, so its cases drive the harness's `roster` sequence rather than a fixed team.
 *
 * The rule they all hold to: the owner is the peer the message reached, and a record the bus could
 * not name still carries the label mail goes to while authorising nothing.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, SUITE_LEAD, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

describe("the owner a handoff records", () => {
	test("records the handoff as told when the bus wrote the message", async () => {
		// The record says the bus took the message, which is all it can say: mail is pruned after a
		// day, so "told" is written and never read.
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });

		expect((await (await store()).read(id))?.owner?.handoff).toEqual({ at: NOW, told: { at: NOW } });
	});

	test("records the peer the message reached, not the one the dry run read", async () => {
		// The bus answers labels, so the id comes from a read after the message: two records under one
		// label, the stopped one first, is the shape that used to record an id no session answers to.
		const { call, seed, store } = harness({
			roster: [
				[{ id: "s-dead", label: "billing-core", state: "gone" }],
				[{ id: "s-live", label: "billing-core", listening: true, state: "live" }],
			],
		});
		const id = await seed();
		expect((await call({ action: "assign", card: id, to: "billing-core" })).isError).toBeFalsy();
		const owner = (await (await store()).read(id))?.owner;
		expect(owner?.id).toBe("s-live");
		expect(owner?.label).toBe("billing-core");
	});

	test("the quiet line and the owner are the same read of the team", async () => {
		// One roster, one story: the message landed on a session whose heartbeat aged out on the way.
		const { call, seed, store } = harness({
			roster: [
				[{ id: "s-core", label: "billing-core", listening: true, state: "live" }],
				[{ id: "s-quiet", label: "billing-core", state: "quiet" }],
			],
		});
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect((await (await store()).read(id))?.owner?.id).toBe("s-quiet");
		expect(resultText(result)).toContain("Quiet: billing-core");
	});

	test("a read that fails after the message records the label, unresolved, and still told", async () => {
		// The transition the pre-send read cannot hide: the dry run named the peer, the message landed,
		// and the read that decides the owner could not answer. The label is where mail goes, the mark
		// withdraws what a label would authorise, and `told` stands because the bus wrote the file.
		const { call, seed, store } = harness({
			roster: [[{ id: "s-billing-core", label: "billing-core", listening: true, state: "live" }], null],
		});
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });

		expect(result.isError).toBeFalsy();
		expect((await (await store()).read(id))?.owner).toEqual({
			label: "billing-core",
			handoff: { at: NOW, told: { at: NOW }, unresolved: true },
		});
		expect(resultText(result)).toContain("The bus could not name that session");
	});

	test("records a handoff the bus could not name as unresolved, and says what that costs", async () => {
		// The bus could not answer either read, so the card has a label and no id. The record says so,
		// and the sender is told the one move left rather than finding out at its next write.
		const { call, seed, store } = harness({ peers: null });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });

		expect(result.isError).toBeFalsy();
		const owner = (await (await store()).read(id))?.owner;
		expect(owner?.id).toBeUndefined();
		expect(owner).toMatchObject({ label: "billing-core", handoff: { at: NOW, unresolved: true } });
		expect(resultText(result)).toContain("The bus could not name that session");
	});

	test("an unresolved owner authorises no write by label, and the lead's reclaim frees it", async () => {
		// The label is where mail goes, not who may write: a session that later draws it must not
		// inherit the card. The lead reclaims, and the peer's claim then records the id it was owed.
		const { call, seed, store } = harness({ peers: null });
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		const store_ = await store();

		const refused = await store_.mutate(
			id,
			{ kind: "note", text: "mine now" },
			{ id: "s-someone-else", label: "billing-core" },
			NOW + 1,
		);
		expect(refused.ok).toBe(false);
		expect((await store_.read(id))?.notes).toHaveLength(0);

		const reclaimed = await store_.mutate(id, { kind: "reclaim" }, { label: SUITE_LEAD }, NOW + 2);
		expect(reclaimed.ok && reclaimed.card.lane).toBe("backlog");

		const claimed = await store_.mutate(
			id,
			{ kind: "claim" },
			{ id: "s-billing-core", label: "billing-core" },
			NOW + 3,
		);
		expect(claimed.ok && claimed.card.owner).toMatchObject({ id: "s-billing-core", label: "billing-core" });
	});

	test("a released card carries no handoff at all, because the record lived on the owner", async () => {
		// Every release and reclaim clears `owner`, and the handoff is a field on it — so a card back
		// in the pool cannot look assigned. The turn-start sweep makes such cards now without anybody
		// asking, which is why this is pinned rather than argued.
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		await (await store()).mutate(id, { kind: "reclaim" }, { label: SUITE_LEAD }, NOW + 1);

		expect((await (await store()).read(id))?.owner).toBeUndefined();
	});
});
