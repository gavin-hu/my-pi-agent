/**
 * The `team` tool's surface, and the two verbs that write the card alone.
 *
 * The registration is what the model reads — four actions and the parameters each one acts
 * on — so the cases assert it off the tool rather than a copy, and the stray-field table is
 * what keeps a parameter from being published to an action that would drop it. `claim` and
 * `reclaim` move the card and nothing else, so they need no bus; the two verbs that send a
 * message live in `handoff.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { ACTION_FIELDS } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

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
