/**
 * The `team` verb that hands a card to one peer: `assign`, and what its message costs.
 *
 * The order is the whole point — a join, then a message, then an assignment, and a card left
 * alone when the join or the message fails — so the cases drive a recording dispatch and assert
 * both the calls made and the card the store ends up with. `offer.test.ts` holds the broadcast,
 * and the board's WIP limits are here because they are the pre-check both verbs read before
 * they send anything.
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

	test("records the handoff as told when the bus wrote the message", async () => {
		// The record says the bus took the message, which is all it can say: mail is pruned after a
		// day, so "told" is written and never read.
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });

		expect((await (await store()).read(id))?.owner?.handoff).toEqual({ at: NOW, told: { at: NOW } });
	});

	test("records a handoff the bus could not write without its told fact", async () => {
		// The peer's inbox refused the file. The card still names them — the pre-check passed and the
		// handoff is owed — but the record says the message never landed, which is what a reader and a
		// re-send both need.
		const { call, seed, store } = harness({
			undelivered: [{ label: "billing-core", error: "no such inbox" }],
		});
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });

		expect(result.isError).toBeFalsy();
		const owner = (await (await store()).read(id))?.owner;
		expect(owner).toMatchObject({ label: "billing-core", handoff: { at: NOW } });
		expect(owner?.handoff?.told).toBeUndefined();
	});

	test("records a handoff the bus could not name as unresolved, and says what that costs", async () => {
		// The bus could not answer, so the card has a label and no id. The record says so, and the
		// sender is told the one move left rather than finding out at its next write.
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

		const reclaimed = await store_.mutate(id, { kind: "reclaim" }, { label: "lead" }, NOW + 2);
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
		const { call, seed, store } = harness({
			undelivered: [{ label: "billing-core", error: "no such inbox" }],
		});
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		await (await store()).mutate(id, { kind: "reclaim" }, { label: "lead" }, NOW + 1);

		expect((await (await store()).read(id))?.owner).toBeUndefined();
	});

	test("sends the handoff first, then records the owner", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core", note: "start with the webhook" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("billing-core");
		expect(sent[0]?.text).toContain("Note: start with the webhook");
		// The board's default lead is the name a sign carries, and it is the name the peer is
		// told to ask: the two moves after `plan` are refused without it.
		expect(sent[0]?.text).toContain("needs the lead (lead) to `approve` the contract");
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

	test("a write that throws after the handoff landed names the send and carries the card", async () => {
		// The one half-apply no rule refused, and the one the bare `catch` in `execute` used to
		// report as nothing: the peer holds the handoff, and the store threw on its way to the
		// owner. A reason alone sent the lead to retry, and the retry was refused as held.
		const broken = harness({ failWrite: "EACCES: permission denied, open 'cards/0001.json'" });
		const id = await broken.seed();
		const result = await broken.call({ action: "assign", card: id, to: "billing-core" });

		expect(broken.sent).toHaveLength(1);
		expect(broken.sent[0]?.to).toBe("billing-core");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(
			`#${id} was handed off to billing-core, but recording the owner failed: EACCES: permission denied`,
		);
		expect(resultText(result)).toContain("billing-core has the message; read the card with `board` action `list`");
		expect(resultText(result)).not.toContain("The card is unchanged.");
		// The card the error carries is the board's, not the message's idea of it: the write threw,
		// so the pool card is what a retry starts from, and the peer's name is what says who heard.
		expect(result.details.card).toMatchObject({ lane: "backlog", id });
		expect(result.details.card?.owner).toBeUndefined();
		expect(result.details.delivered).toEqual(["billing-core"]);
		expect(await (await broken.store()).read(id)).toMatchObject({ lane: "backlog" });
	});

	test("a card taken while the handoff is in flight is the rival's, and the peer is told", async () => {
		// The one window the pre-check cannot see: the message is on its way and the card has
		// not been touched, so another session claims it there. The assignment's own write is
		// then refused against a card that is no longer free.
		let id = "";
		const race = harness({
			duringSend: async (input) => {
				if (input.kind !== "handoff") return;
				const claimed = await (await race.store()).mutate(id, { kind: "claim" }, { label: "billing-web" }, NOW + 1);
				expect(claimed.ok).toBe(true);
			},
		});
		id = await race.seed();
		const result = await race.call({ action: "assign", card: id, to: "billing-core" });

		// The message went out first and carries the sentence that makes it survivable: without
		// it the peer works a card somebody else holds, and finds out only when its own next call
		// is refused naming the rival — the handoff it acted on never said the card might not be
		// its.
		expect(race.sent).toHaveLength(1);
		expect(race.sent[0]?.text).toContain("If the board shows another owner");
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain(`#${id} was handed off to billing-core, but recording the owner was refused`);
		expect(result.details.card).toMatchObject({ owner: { label: "billing-web" }, lane: "plan" });
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
		writeFileSync(join(board.cwd, ".pi", "bytefly.json"), JSON.stringify({ board: { wip: { plan: 1, execute: 1 } } }));
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
