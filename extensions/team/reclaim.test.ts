/**
 * `reclaim` through the round's tool: the fact it reads off the bus, and the refusal a peer gets.
 *
 * A reclaim's rule is the one board decision that needs a second session's record as well as a
 * card, so its cases read a record the suite writes rather than a fixture's idea of one. The
 * action's own rules and sentences are `lib/board/reclaim.test.ts`; this is the `team` door.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { Claims } from "../../lib/board/claims.ts";
import { presetNameFor } from "../../lib/session-label.ts";
import { SESSION_TTL_MS } from "../../lib/session-roster.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, type TeamSuite, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { writeBusRecord } from "../../test/helpers/bus.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

/** The name this suite's session draws, which is the label the board's lead has to carry. */
const LEAD = presetNameFor("s-lead") ?? "s-lead";

/** A heartbeat past the bus's window, which is the answer that lets a peer take a card back. */
const QUIET = NOW - SESSION_TTL_MS - 1;

/**
 * The bus a reclaim's lane crossing writes to: a release frees what the caller holds, so a card
 * taken back from a peer frees nothing of that peer's.
 */
function crossing(notOwned: readonly string[]): Claims {
	return {
		loaded: () => true,
		claim: async (_ctx, paths) => ({ ok: true, claimed: [...paths], conflicts: [] }),
		release: async (_ctx, paths) => ({
			ok: true,
			released: paths.filter((path) => !notOwned.includes(path)),
			notOwned: [...notOwned],
		}),
	};
}

/** Leave a record on the bus for the session holding a card, `lastSeen` old. */
async function recordFor(suite: TeamSuite, label: string, lastSeen: number): Promise<void> {
	await writeBusRecord(await suite.busDir(), { id: `s-${label}`, label, lastSeen });
}

describe("reclaim", () => {
	test("clears the owner and keeps the notes, from a holder whose record says it stopped", async () => {
		const suite = harness();
		const { call, seed, store } = suite;
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await board.mutate(id, { kind: "note", text: "half done" }, { label: "billing-core" }, NOW);
		// The heartbeat aged out, which is the one answer that makes a peer's card anybody's.
		await recordFor(suite, "billing-core", QUIET);

		const result = await call({ action: "reclaim", card: id });
		expect(result.isError).toBeFalsy();
		expect(result.details.card).toMatchObject({ lane: "backlog" });
		expect(result.details.card?.owner).toBeUndefined();
		expect(result.details.card?.notes.map((note) => note.text)).toEqual(["half done"]);
		expect(resultText(result)).toContain("#1 reclaimed from billing-core");
	});

	test("refuses a card a running peer holds, and the lead takes it back", async () => {
		const peer = harness();
		const id = await peer.seed();
		const board = await peer.store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await recordFor(peer, "billing-core", NOW);
		const refused = await peer.call({ action: "reclaim", card: id });
		expect(refused.isError).toBe(true);
		expect(refused.details.error).toContain("only the lead");
		// The refused call wrote nothing: the card is still the peer's.
		expect((await board.read(id))?.owner?.label).toBe("billing-core");

		// The lead's session, under the name the board signs as, is the other door.
		const lead = harness({ lead: LEAD });
		const held = await lead.seed();
		const leadBoard = await lead.store();
		await leadBoard.mutate(held, { kind: "claim" }, { label: "billing-core" }, NOW);
		await recordFor(lead, "billing-core", NOW);
		const taken = await lead.call({ action: "reclaim", card: held });
		expect(taken.isError).toBeFalsy();
		expect(taken.details.card?.lane).toBe("backlog");
	});

	test("refuses a card nobody holds, and one that is finished", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		expect(resultText(await call({ action: "reclaim", card: id }))).toContain("has no owner to reclaim.");

		const board = await store();
		const other = await board.create({ title: "Second", paths: [] }, { label: "billing-lead" }, NOW);
		const { advance } = await import("../../test/helpers/board-flow.ts");
		await advance(board, other.id, "done", { owner: { label: "billing-core" } }, NOW);
		expect(resultText(await call({ action: "reclaim", card: other.id }))).toContain("is done");
	});

	test("names the paths the old holder keeps, because a release frees only the writer's", async () => {
		// The round's crossing is the board's rule, so the clause a reclaim earns is the same one
		// the board's door prints: the card is back in the pool and the files are not.
		const suite = harness({ lead: LEAD, claims: crossing(["src/billing"]) });
		const { call, seed, store } = suite;
		const id = await seed();
		const { advance } = await import("../../test/helpers/board-flow.ts");
		await advance(await store(), id, "execute", { owner: { label: "billing-core" } }, NOW);

		const result = await call({ action: "reclaim", card: id });
		expect(result.isError).toBeFalsy();
		expect(result.details.card?.lane).toBe("backlog");
		expect(resultText(result)).toContain(`#${id} reclaimed from billing-core and back in Backlog`);
		expect(resultText(result)).toContain("  1 path stays held by billing-core until it stops");
	});

	test("sends nothing", async () => {
		const suite = harness();
		const { call, seed, store, sent } = suite;
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await recordFor(suite, "billing-core", QUIET);
		expect((await call({ action: "reclaim", card: id })).isError).toBeFalsy();
		expect(sent).toEqual([]);
	});
});
