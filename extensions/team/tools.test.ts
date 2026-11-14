/**
 * The `team` tool's surface, and the verbs that write the card alone.
 *
 * The registration is what the model reads — three actions and the parameters each one acts
 * on — so the cases assert it off the tool rather than a copy, and the stray-field table is
 * what keeps a parameter from being published to an action that would drop it. `offer` writes
 * the card and sends one message, so it needs no bus here; `assign` and `ask`, which need one,
 * live in `handoff.test.ts` and `ask.test.ts`. The transcript block is the same surface seen by a
 * human: one collapsed line, and the result's own lines behind the expand key.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { Card } from "../../lib/board/card.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { type TeamSuite, type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { fakeTheme, toolRenderContext } from "../../test/helpers/fakes.ts";
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

	test("says the card's own state is `board`'s, and offers it nowhere", () => {
		const { tool } = harness();
		// The three verbs here all need the bus: the two that wrote the card alone (`reclaim` and
		// `claim`) are `board`'s, so a sentence offering one would be a second door onto a store
		// operation this tool does not own.
		expect(tool.description).toContain("`board`'s");
		expect(tool.description).not.toContain("`claim`");
		expect(tool.description).not.toContain("`reclaim`");
	});

	test("says an offer records the moment, not that it writes nothing", () => {
		const { tool } = harness();
		// The shipped path calls the store, which sets `offeredAt` and bumps `rev` and
		// `updatedAt`; "writes nothing" read as a free probe and hid that write. The schema's copy
		// drifted on exactly this, so the copy is gone: the description is the one surface that says
		// what a verb does, and the parameter only names the fields it takes.
		expect(tool.description).toContain("records the moment it was made");
		expect(tool.description).not.toContain("writes nothing");
		expect(tool.parameters.properties.action.description).not.toContain("records the moment");
	});

	test("refuses an action it does not have, without throwing", async () => {
		const { call } = harness();
		const result = await call({ action: "spawn", card: "1" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("unknown action");
	});

	test("refuses a card id that is not one", async () => {
		const { call } = harness();
		expect(resultText(await call({ action: "offer", card: "four" }))).toContain('"four" is not a card id.');
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
		expect((await call({ action: "assign", card: second, to: "billing-web" })).isError).toBeFalsy();
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
		// Both refuse before they reach the store's write or a peer, so a session whose call did
		// nothing does not appear on the team it never addressed.
		expect((await call({ action: "assign", card: "9", to: "billing-core" })).isError).toBe(true);
		expect((await call({ action: "ask" })).isError).toBe(true);
		expect(joined).toEqual([]);
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

	test("a quiet peer is named quiet, not counted among the ones that were told", async () => {
		// The bus wrote the file, so the handoff landed — and nothing says the session is still there
		// to read it. `delivered` alone would read as heard.
		const { call, tool, seed } = harness({
			peers: [{ id: "s-core", label: "billing-core", listening: true, state: "quiet" }],
		});
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(result.details.quiet).toEqual(["billing-core"]);
		expect(result.isError).toBeFalsy();
		const expanded = block(tool, result, true);
		expect(expanded).toContain("Quiet: billing-core — nothing says it is still there.");
		expect(expanded).not.toContain("Not listening: billing-core");
	});

	test("a busy round names the verb it waits on, and the settled line carries the duration", async () => {
		const { call, tool, seed } = harness();
		const id = await seed();
		const args = { action: "assign", card: id, to: "billing-core" };
		const result = await call(args);
		// A live frame carries no details, so the verb comes off the call's own arguments.
		const context = { ...toolRenderContext(), args, durationMs: 2100 };
		const live = tool
			.renderResult({ content: [] }, { expanded: false, isPartial: true }, fakeTheme, context)
			.render(80)
			.join("\n");
		// The live frame's number comes off the wall clock, so the verb is what a suite can hold;
		// `elapsedSuffix`'s own numbers are `lib/tui`'s case.
		expect(live).toContain("Handing over");
		const settled = tool
			.renderResult(result, { expanded: false, isPartial: false }, fakeTheme, context)
			.render(80)
			.join("\n");
		expect(settled.trim()).toBe(`#${id} plan → billing-core · 2.1s`);
		// The settled frame clears the interval the live line started, so nothing ticks after it.
		expect((context.state as { elapsedTimer?: unknown }).elapsedTimer).toBeUndefined();
	});

	test("hands Pi a partial result while the send is in flight", async () => {
		let partials = 0;
		let duringSend = 0;
		const { tool, seed, ctx } = harness({
			duringSend: () => {
				duringSend = partials;
			},
		});
		const id = await seed();
		await tool.execute(
			"call-1",
			{ action: "assign", card: id, to: "billing-core" },
			undefined,
			() => {
				partials += 1;
			},
			ctx,
		);
		// The message is on its way and the card is not yet touched: that wait is what the live line covers.
		expect(duringSend).toBe(1);
		expect(partials).toBe(1);
	});

	test("the call line names the peer for ask, the one verb with no card", () => {
		const { tool } = harness();
		const line = (args: Record<string, unknown>): string =>
			tool.renderCall(args, fakeTheme, { lastComponent: undefined }).render(80).join("\n");
		// `ask` acts on a peer and nothing else, so a subject that stopped at the verb hid the
		// only thing the call was about.
		expect(line({ action: "ask", to: "billing-core" })).toContain("ask → billing-core");
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
