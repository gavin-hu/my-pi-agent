/**
 * The `team` tool: the order of a handoff, and what each failure leaves behind.
 *
 * The ordering is the whole point — a message before an assignment, and a card
 * untouched when the message fails — so the cases drive a recording dispatch and
 * assert both the calls made and the card the store ends up with.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { openBoardSession } from "../../lib/board/session.ts";
import type { TeamJoin } from "../../lib/session-tool.ts";
import type { Peer } from "../../lib/session-tool.ts";
import type { Dispatch } from "./dispatch.ts";
import { registerTools } from "./tools.ts";
import { ACTION_FIELDS, type TeamDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 90_000;

/** A tool, its context, and the dispatch it records into. */
function harness(options: { fail?: string; peers?: Peer[]; joinLabel?: string } = {}) {
	const agentDir = temps.track(tempDir("pi-agent-"));
	const cwd = temps.track(tempDir("pi-repo-"));
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const session = openBoardSession(fake.pi, { now: () => NOW, agentDir });
	const sent: Array<{ kind: "handoff" | "event"; to: string; text: string }> = [];
	const dispatch: Dispatch = {
		async send(input) {
			if (options.fail !== undefined) throw new Error(options.fail);
			sent.push(input);
			return { delivered: input.to === "*" ? ["billing-core", "billing-web"] : [input.to] };
		},
		// A stub that lists the peers the sends reached, so the assign path records the id
		// a rename would keep; a case that needs a state passes its own list.
		async peers() {
			return options.peers ?? sent.map((input) => ({ id: `s-${input.to}`, label: input.to, listening: true }));
		},
	};
	// The join a claim makes: recorded, so no case asks a bus that is not there.
	const joined: string[] = [];
	const team: TeamJoin = {
		async join(_ctx, input) {
			const label = input?.label ?? options.joinLabel ?? "billing-lead";
			joined.push(label);
			return { ok: true, label, watching: { armed: true, wake: false } };
		},
	};
	registerTools(fake.pi, session, { dispatch: () => dispatch, team });
	const tool = fake.tools.get("team");
	if (!tool) throw new Error("the team tool was not registered");
	const { ctx } = fakeCtx({ cwd, sessionId: "s-lead", sessionName: "billing-lead" });
	return {
		tool,
		ctx,
		sent,
		joined,
		cwd,
		/** Who this session writes as — the label and id a refusal has to compare against. */
		async me() {
			return await session.who(ctx, cwd);
		},
		/** The store this session works on, so a case seeds the same board it reads. */
		store: () => session.store(cwd),
		/** Publish one card on that board and return its id. */
		async seed(title = "Billing webhook accepts orders"): Promise<string> {
			const store = await session.store(cwd);
			await store.ensure();
			const card = await store.create({ title, paths: ["src/billing"] }, { label: "billing-lead" }, NOW);
			return card.id;
		},
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, ctx)) as {
				content: Array<{ text: string }>;
				details: TeamDetails;
				isError?: boolean;
			};
		},
	};
}

describe("the registration", () => {
	test("declares the surface the tool needs", () => {
		const { tool } = harness();
		expect(tool.name).toBe("team");
		expect(tool.promptSnippet.length).toBeGreaterThan(0);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
		expect(tool.executionMode).toBe("sequential");
	});

	test("says which action needs no team", () => {
		const { tool } = harness();
		// Read every session, so the claim has to be the true one: `reclaim` writes the card
		// alone, and a model told otherwise goes looking for a bus it does not need.
		expect(tool.description).toContain("needs no team");
		expect(tool.description).not.toContain("All three need the team");
	});

	test("refuses an action it does not have, without throwing", async () => {
		const { call } = harness();
		const result = await call({ action: "spawn", card: "1" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("unknown action");
	});

	test("refuses a card id that is not one", async () => {
		const { call } = harness();
		expect(resultText(await call({ action: "reclaim", card: "four" }))).toContain('"four" is not a card id.');
	});
});

describe("a field the action does not act on", () => {
	test("an offer that names a peer is refused rather than broadcast", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		// The field would have been dropped: every other live session got the card while the
		// caller believed it had named one of them.
		const result = await call({ action: "offer", card: id, to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toBe("offer does not act on to: `assign` takes it.");
		expect(sent).toEqual([]);
	});

	test("a reclaim that names one is refused, and the card is left alone", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		const before = await (await store()).read(id);
		const result = await call({ action: "reclaim", card: id, to: "billing-core" });
		expect(result.details.error).toBe("reclaim does not act on to: `assign` takes it.");
		// Whoever held it still does: the refusal reached the card in no way at all.
		expect((await (await store()).read(id))?.owner?.label).toBe("billing-core");
		expect((await (await store()).read(id))?.rev).toBe(before?.rev);
	});

	test("names the action that takes every stray field, and sends nothing", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "offer", card: id, to: "billing-core", title: "x" });
		expect(result.details.error).toBe(
			"offer does not act on to, title: `assign` takes to; title belongs to no action.",
		);
		expect(sent).toEqual([]);
	});

	test("leaves the fields the action does read alone", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		// The shapes that would break first if the table were too eager: an offer reads its
		// note, and an assign reads a peer and a note.
		expect((await call({ action: "offer", card: id, note: "whoever is free" })).isError).toBeFalsy();
		expect((await call({ action: "assign", card: id, to: "billing-core", note: "start here" })).isError).toBeFalsy();
		expect(sent).toHaveLength(2);
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const { tool } = harness();
		const published = Object.keys(tool.parameters.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(ACTION_FIELDS).flat());
		// A new parameter with no owner is the same defect one step along: published to every
		// action, acted on by some, silently dropped by the rest.
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});

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
});

describe("claim", () => {
	test("takes the card into plan for this session, and asks to join once", async () => {
		const { call, seed, joined, me } = harness();
		const self = await me();
		const id = await seed();
		const result = await call({ action: "claim", card: id });
		expect(result.isError).toBeFalsy();
		expect(result.details.card).toMatchObject({ lane: "plan", owner: { label: self.label } });
		expect(resultText(result)).toContain(`#${id} is yours, in plan.`);
		// The claim's one side effect outside the card: a claim is what makes the session a
		// teammate, so it asks the same join `board`'s claim asks for — once per session.
		expect(joined).toEqual([self.label]);
		const second = await seed("Second");
		expect((await call({ action: "claim", card: second })).isError).toBeFalsy();
		expect(joined).toEqual([self.label]);
	});

	test("a claim answers an offer, clearing the record with the write", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "offer", card: id });
		expect((await (await store()).read(id))?.offeredAt).toBe(NOW);
		await call({ action: "claim", card: id });
		expect((await (await store()).read(id))?.offeredAt).toBeUndefined();
	});

	test("refuses a card somebody holds, and one that waits", async () => {
		const { call, seed, store } = harness();
		const board = await store();
		const first = await seed("First");
		await board.mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const held = await call({ action: "claim", card: first });
		expect(held.isError).toBe(true);
		expect(resultText(held)).toContain("is held by billing-core");

		const second = await seed("Second");
		await board.mutate(
			second,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [first] },
			{ label: "billing-core" },
			NOW,
		);
		const waiting = await call({ action: "claim", card: second });
		expect(waiting.isError).toBe(true);
		expect(resultText(waiting)).toContain("waits on");
	});

	test("refuses a field the action does not read", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		const result = await call({ action: "claim", card: id, to: "billing-core" });
		expect(result.details.error).toBe("claim does not act on to: `assign` takes it.");
		expect((await (await store()).read(id))?.lane).toBe("backlog");
	});

	test("refuses a card that does not exist", async () => {
		const { call } = harness();
		const result = await call({ action: "claim", card: "9" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("#9 does not exist.");
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

describe("reclaim", () => {
	test("clears the owner and keeps the notes", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await board.mutate(id, { kind: "note", text: "half done" }, { label: "billing-core" }, NOW);

		const result = await call({ action: "reclaim", card: id });
		expect(result.isError).toBeFalsy();
		expect(result.details.card).toMatchObject({ lane: "backlog" });
		expect(result.details.card?.owner).toBeUndefined();
		expect(result.details.card?.notes.map((note) => note.text)).toEqual(["half done"]);
		expect(resultText(result)).toContain("#1 reclaimed from billing-core");
	});

	test("refuses a card nobody holds, and one that is finished", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		expect(resultText(await call({ action: "reclaim", card: id }))).toContain("has no owner to reclaim.");

		const board = await store();
		const other = await board.create({ title: "Second", paths: [] }, { label: "billing-lead" }, NOW);
		await advance(board, other.id, "done", { owner: { label: "billing-core" } }, NOW);
		expect(resultText(await call({ action: "reclaim", card: other.id }))).toContain("is done");
	});

	test("sends nothing", async () => {
		const { call, seed, store, sent } = harness();
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await call({ action: "reclaim", card: id });
		expect(sent).toEqual([]);
	});
});
