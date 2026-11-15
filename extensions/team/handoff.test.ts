/**
 * The `team` verb that hands a card to one peer: `assign`, and what its message costs.
 *
 * The order is the whole point — a join, then a message, then an assignment, and a card left
 * alone when the join or the message fails — so the cases drive a recording dispatch and assert
 * both the calls made and the card the store ends up with. Which session the write then names is
 * `owner.test.ts`'s question; `offer.test.ts` holds the broadcast, and the board's WIP limits are
 * here because they are the pre-check both verbs read before they send anything.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, SUITE_LEAD, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

describe("assign", () => {
	test("joins before it sends, then sends the handoff, then records the owner", async () => {
		const board = harness({
			duringSend: () => {
				// The handoff's last line sends the peer to this session for its two gates, so the label
				// has to be on the bus before the message that names it is written.
				expect(board.joined).toHaveLength(1);
			},
		});
		const id = await board.seed();
		const self = await board.me();
		const result = await board.call({ action: "assign", card: id, to: "billing-core" });
		expect(result.isError).toBeFalsy();
		expect(board.sent).toHaveLength(1);
		expect(board.joined).toEqual([self.label]);
	});

	test("a join that does not land refuses the handoff, and sends nothing", async () => {
		// The one failure the old order could not report at all: the message went out first, so a
		// lead the bus will not hold handed a peer a reply its own `session send` refuses.
		const { call, seed, sent, store, joined, me } = harness({
			joinFails: 'the label "billing-lead" is already in use by session s-9.',
		});
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(joined).toEqual([(await me()).label]);
		expect(sent).toEqual([]);
		expect(resultText(result)).toContain(
			`#${id} was not handed off to billing-core: this session is not on the team — the label`,
		);
		expect(resultText(result)).toContain("Nothing was sent.");
		expect((await (await store()).read(id))?.owner).toBeUndefined();
	});

	test("writes the owner first, then sends the handoff", async () => {
		let id = "";
		const { call, seed, sent, store } = harness({
			duringSend: async () => {
				// The peer reads a card that already holds it: the write is what the message reports.
				expect((await (await store()).read(id))?.owner?.id).toBe("s-billing-core");
			},
		});
		id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core", note: "start with the webhook" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		// The id, not the label: an id is unambiguous when two records share a name.
		expect(sent[0]?.to).toBe("s-billing-core");
		expect(sent[0]?.about).toBe(id);
		expect(sent[0]?.key).toBe(`card:${id}:assign:${(await (await store()).read(id))?.owner?.handoff?.at}`);
		expect(sent[0]?.text).toContain("Note: start with the webhook");
		// The board's default lead is the name a sign carries, and it is the name the peer is
		// told to ask: the two moves after `plan` are refused without it.
		expect(sent[0]?.text).toContain(`needs the lead (${SUITE_LEAD}) to \`approve\` the contract`);
		expect(sent[0]?.text).toContain("`done` needs the lead's `review`");
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
		// A repeat for the same peer is refused before anything is sent: the write would be a
		// no-op, so the only thing a second assign added was a handoff for a card already its own.
		const again = await call({ action: "assign", card: id, to: "billing-core" });
		expect(again.isError).toBe(true);
		expect(resultText(again)).toContain(`#${id} is already billing-core's.`);
		expect(sent).toHaveLength(1);
	});

	test("names the lead the project configured, not the default", async () => {
		const { call, seed, sent } = harness({ lead: "billing-lead" });
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		// The name reaches the wire from the same store the gate reads, so the peer is sent to
		// the session that can actually sign its card.
		expect(sent[0]?.text).toContain("needs the lead (billing-lead) to `approve` the contract");
		expect(sent[0]?.text).toContain("ask billing-lead with `session send` when each is ready");
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

	test("a send that fails leaves the card the peer's, and says the message did not reach it", async () => {
		const { call, seed, sent, store } = harness({ fail: "the bus is not loaded." });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			`#${id} is billing-core's, but the handoff did not reach it: the bus is not loaded.`,
		);
		expect(resultText(result)).toContain("Assign it again to retry");
		expect(sent).toEqual([]);
		// The state landed; only the report of it did not, and the handoff reads untold.
		const written = await (await store()).read(id);
		expect(written?.owner).toMatchObject({ id: "s-billing-core", label: "billing-core" });
		expect(written?.owner?.handoff?.told).toBeUndefined();
	});

	test("a write that throws sends nothing, and leaves the card alone", async () => {
		const broken = harness({ failWrite: "EACCES: permission denied, open 'cards/0001.json'" });
		const id = await broken.seed();
		const result = await broken.call({ action: "assign", card: id, to: "billing-core" });

		// State first: a write that cannot land is a handoff that never happened, so the peer is
		// not woken for a card nobody will find it holding.
		expect(broken.sent).toEqual([]);
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(`#${id} was not handed off to billing-core: EACCES: permission denied`);
		expect(await (await broken.store()).read(id)).toMatchObject({ lane: "backlog" });
	});

	test("an untold handoff is retried by the same assign, and the key folds", async () => {
		// State first: the card is the peer's while the message is not. The repeat of the same verb is
		// the retry, and it composes the handoff's own key, so the bus folds it into the copy waiting.
		const board = harness({ failOnce: "the bus is not loaded." });
		const id = await board.seed();
		const failed = await board.call({ action: "assign", card: id, to: "billing-core" });
		expect(failed.isError).toBe(true);
		expect((await (await board.store()).read(id))?.owner?.handoff?.told).toBeUndefined();

		const again = await board.call({ action: "assign", card: id, to: "billing-core" });
		expect(again.isError).toBeFalsy();
		// The failed send wrote no message, so the repeat is the only one — keyed by the handoff's own
		// stamp, which no note between the two moved.
		const written = await (await board.store()).read(id);
		expect(board.sent).toHaveLength(1);
		expect(board.sent[0]?.key).toBe(`card:${id}:assign:${written?.owner?.handoff?.at}`);
		expect(written?.owner?.handoff?.told).toEqual({ at: NOW });
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

	test("refuses the holder the same way by id and by label, and sends nothing", async () => {
		const { call, seed, store, sent } = harness();
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
			expect(result.isError, id).toBe(true);
			expect(resultText(result), id).toContain(`#${id} is already billing-core's.`);
			// What it used to accept was a no-op write; the message is what a peer acts on.
			expect((await board.read(id))?.rev, id).toBe(before?.rev);
		}
		expect(sent).toEqual([]);
	});
});

describe("the board's WIP limits", () => {
	/** A harness whose project config caps `plan` at one card, written before the store opens. */
	function capped() {
		const board = harness();
		mkdirSync(join(board.cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(board.cwd, ".pi", "bytefly.json"),
			JSON.stringify({ board: { wip: { plan: 1, execute: 1, perOwner: 20 } } }),
		);
		return board;
	}

	test("a full plan lane refuses the handoff before anything is sent", async () => {
		const { call, seed, store, sent, joined } = capped();
		const first = await seed("First");
		const second = await seed("Second");
		await (await store()).mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const refused = await call({ action: "assign", card: second, to: "billing-core" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain(`#${second} cannot enter plan`);
		expect(resultText(refused)).toContain("the limit is 1");
		expect(sent).toEqual([]);
		// The join comes after every rule, so a handoff the board refuses enlists nobody.
		expect(joined).toEqual([]);
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
});
