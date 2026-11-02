/**
 * The `team` tool's surface, and the two verbs that write the card alone.
 *
 * The registration is what the model reads — four actions and the parameters each one acts
 * on — so the cases assert it off the tool rather than a copy, and the stray-field table is
 * what keeps a parameter from being published to an action that would drop it. `claim`,
 * `reclaim`, and the join the round asks for move the card and no message, so they need no
 * bus; the two verbs that send one live in `handoff.test.ts`. The transcript block is the
 * same surface seen by a human: one collapsed line, and the result's own lines behind the
 * expand key.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { Card } from "../../lib/board/card.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { NOW, type TeamSuite, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { ACTION_FIELDS, TEAM_ACTIONS, type TeamDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

/**
 * Whether a prompt surface names a verb, as a word rather than as the tail of a longer one.
 *
 * Both surfaces are prose: the description writes `` `claim` `` and the snippet writes `claim`
 * bare, so an anchored match is the one rule that reads them the same way — and `reclaim`
 * stops answering for `claim`.
 */
function named(text: string, action: string): boolean {
	return new RegExp(`\\b${action}\\b`).test(text);
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

	test("names every verb it has, in the snippet and in the description", () => {
		const { tool } = harness();
		// The snippet is the one line the always-on tool list carries, so a verb missing there is
		// a verb a model only discovers from the schema — `ask` was absent from it for a release.
		for (const action of TEAM_ACTIONS) {
			expect(named(tool.promptSnippet, action), `${action} in the snippet`).toBe(true);
			expect(named(tool.description, action), `${action} in the description`).toBe(true);
		}
		// A substring check would let `reclaim` answer for `claim`, which is the verb this guard
		// exists for; the boundary is what makes the case mean what it says.
		expect(named("Run a round: reclaim one.", "claim")).toBe(false);
	});

	test("says which action needs no team", () => {
		const { tool } = harness();
		// Read every session, so the claim has to be the true one: `reclaim` writes the card
		// alone, and a model told otherwise goes looking for a bus it does not need.
		expect(tool.description).toContain("needs no team");
		expect(tool.description).not.toContain("All three need the team");
	});

	test("says an offer records the moment, not that it writes nothing", () => {
		const { tool } = harness();
		// The shipped path calls the store, which sets `offeredAt` and bumps `rev` and
		// `updatedAt`; "writes nothing" read as a free probe and hid that write. Both
		// model-facing surfaces say it, so both are pinned — the schema's copy drifted first.
		for (const text of [tool.description, tool.parameters.properties.action.description]) {
			expect(text).toContain("records the moment it was made");
			expect(text).not.toContain("writes nothing");
		}
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
		expect(result.details.error).toBe("offer does not act on to: `assign` and `ask` take it.");
		expect(sent).toEqual([]);
	});

	test("a reclaim that names one is refused, and the card is left alone", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		await call({ action: "assign", card: id, to: "billing-core" });
		const before = await (await store()).read(id);
		const result = await call({ action: "reclaim", card: id, to: "billing-core" });
		expect(result.details.error).toBe("reclaim does not act on to: `assign` and `ask` take it.");
		// Whoever held it still does: the refusal reached the card in no way at all.
		expect((await (await store()).read(id))?.owner?.label).toBe("billing-core");
		expect((await (await store()).read(id))?.rev).toBe(before?.rev);
	});

	test("names the action that takes every stray field, and sends nothing", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "offer", card: id, to: "billing-core", title: "x" });
		expect(result.details.error).toBe(
			"offer does not act on to, title: `assign` and `ask` take to; title belongs to no action.",
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

	test("asks again when the bus no longer holds this session", async () => {
		const { call, seed, joined, me, leaveBus } = harness();
		const self = await me();
		await call({ action: "claim", card: await seed() });
		// The join left a record, so the next claim reads it and asks nothing.
		await call({ action: "claim", card: await seed("Second") });
		expect(joined).toEqual([self.label]);
		// A stopped bus takes its record with it, and a standing that outlived it is no evidence
		// that peers resolve this session: the next claim joins again rather than writing under a
		// name nobody answers to.
		leaveBus();
		await call({ action: "claim", card: await seed("Third") });
		expect(joined).toEqual([self.label, self.label]);
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
		expect(result.details.error).toBe("claim does not act on to: `assign` and `ask` take it.");
		expect((await (await store()).read(id))?.lane).toBe("backlog");
	});

	test("refuses a card that does not exist", async () => {
		const { call } = harness();
		const result = await call({ action: "claim", card: "9" });
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("#9 does not exist.");
	});
});

describe("the join a round makes", () => {
	test("a handoff joins under the lead's own label, once for the session", async () => {
		const { call, seed, joined, me } = harness();
		const self = await me();
		const id = await seed();
		expect((await call({ action: "assign", card: id, to: "billing-core" })).isError).toBeFalsy();
		// The label the reply line names and the card records — and one join, not one per call:
		// the reply to a handoff is mail a lead that only runs the round would otherwise miss.
		expect(joined).toEqual([self.label]);
		await call({ action: "ask", to: "billing-web", question: "any blockers?" });
		const second = await seed("Second");
		await call({ action: "claim", card: second });
		expect(joined).toEqual([self.label]);
	});

	test("an ask joins, because the answer arrives as mail", async () => {
		const { call, joined, me } = harness();
		const self = await me();
		expect((await call({ action: "ask", to: "billing-core" })).isError).toBeFalsy();
		expect(joined).toEqual([self.label]);
	});

	test("a refused call joins nobody", async () => {
		const { call, joined } = harness();
		// All three refuse before they reach the store's write or a peer, so a session whose
		// call did nothing does not appear on the team it never addressed.
		expect((await call({ action: "assign", card: "9", to: "billing-core" })).isError).toBe(true);
		expect((await call({ action: "ask" })).isError).toBe(true);
		expect((await call({ action: "claim", card: "9" })).isError).toBe(true);
		expect(joined).toEqual([]);
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

describe("the transcript block", () => {
	/** One result rendered at 80 columns, the way the transcript asks for it. */
	const block = (tool: TeamSuite["tool"], result: unknown, expanded: boolean): string =>
		tool
			.renderResult(result, { expanded, isPartial: false }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");

	test("collapsed is the one summary line, and expanding draws the lines the model got", async () => {
		// The peer's record says it is not listening, so the result carries the one fact a human
		// cannot get from the card: that the handoff waits for that peer's next turn.
		const { call, tool, seed } = harness({ peers: [{ id: "s-core", label: "billing-core", listening: false }] });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(block(tool, result, false).trim()).toBe(`#${id} plan → billing-core`);
		const expanded = block(tool, result, true);
		// The sentences `format.ts` wrote for the model, drawn rather than repeated: the card's
		// title and paths, then who reads the message when.
		expect(expanded).toContain("Billing webhook accepts orders");
		// The continuation indent survives the sanitizer, which trims a line: a title under the
		// sentence it belongs to is not a list item.
		expect(expanded).toContain("  paths: src/billing");
		expect(expanded).toContain("Not listening: billing-core");
		expect(expanded).not.toBe(block(tool, result, false));
	});

	test("the call line names the peer for ask, the one verb with no card", () => {
		const { tool } = harness();
		const line = (args: Record<string, unknown>): string =>
			tool.renderCall(args, fakeTheme, { lastComponent: undefined }).render(80).join("\n");
		// `ask` acts on a peer and nothing else, so a subject that stopped at the verb hid the
		// only thing the call was about.
		expect(line({ action: "ask", to: "billing-core" })).toContain("ask → billing-core");
		expect(line({ action: "reclaim", card: "2" })).toContain("reclaim #2");
		// `offer` broadcasts, so a peer in its args is a stray field the call refuses: the subject
		// never names one.
		expect(line({ action: "offer", card: "2", to: "billing-core" })).not.toContain("billing-core");
	});

	test("an expanded block neutralizes the text it draws", async () => {
		const { tool, seed, store } = harness();
		const id = await seed();
		const card = (await (await store()).read(id)) as Card;
		// A card's title is user data, so it reaches the block through the sanitizer: the escapes
		// a stored title could carry never reach the terminal.
		const result = {
			content: [{ type: "text", text: `#${id} handed off to billing-core.\n  Ev\u001b[31mil\u0007 title` }],
			details: { action: "assign", card } as TeamDetails,
		};
		const expanded = block(tool, result, true);
		expect(expanded).not.toContain("\u001b");
		expect(expanded).not.toContain("\u0007");
		expect(expanded).toContain("title");
	});
});
