/**
 * The board's record: what a finished card costs the board, and what a cap costs the card.
 *
 * Two facts a reader needed and could not see — how much history a sweep may fold away, and
 * which cards lost notes or transitions to a cap — so the sweep, the word that runs it, and
 * the two lines that name it are pinned here. The outcome the sweep reports is here too, for
 * the same reason: `tools.test.ts` and `commands.test.ts` are both named at their height in
 * `test/suite-sizes.test.ts`, which is why this suite exists.
 */

import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Card } from "../../lib/board/card.ts";
import type { Actor } from "../../lib/board/rules.ts";
import { buildRound } from "../../lib/board/round.ts";
import { formatRound } from "../../lib/board/round-text.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardCard, numberedCard, resultText } from "../../test/helpers/fixtures/board.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { sweepFinished, sweepText } from "./archive.ts";
import { BOARD_COMMAND, registerCommands } from "./commands.ts";
import { formatCard } from "./format.ts";
import type { BoardPage } from "./page.ts";
import { registerTools } from "./tools.ts";
import { BOARD_TOOL, type BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 50_000;
const ME: Actor = { id: "s-lead", label: "billing-core" };

/** A board with a store, and the session a command or a tool works as. */
function board() {
	const harness = boardHarness({ now: NOW, track: temps.track, sessionId: ME.id, sessionName: ME.label });
	const session: BoardSession = {
		store: (cwd: string) => harness.runtime.store(cwd),
		planDir: (cwd: string) => harness.runtime.planDir(cwd),
		busDir: (cwd: string) => harness.runtime.busDir(cwd),
		roster: (cwd: string) => harness.runtime.roster(cwd),
		now: () => NOW,
		who: async () => ME,
		serving: () => undefined,
		serve: () => {},
		team: { last: () => undefined, record: () => {} },
	};
	return { harness, session };
}

/** A page the sweep never touches: the word opens a store, not a browser. */
const NO_PAGE: BoardPage = {
	start: async () => {
		throw new Error("the archive word opens no page");
	},
	stop: async () => false,
	status: async () => ({ running: false }),
	dropStale: async () => "gone",
	closeAll: async () => {},
};

describe("the sweep", () => {
	test("keeps a finished card an open card still waits on, and says why", async () => {
		const { harness, session } = board();
		const store = await harness.runtime.store(harness.ctx.cwd);
		const first = await store.create({ title: "Finished one", paths: [] }, ME, NOW);
		const second = await store.create({ title: "Waiting one", paths: [] }, ME, NOW);
		await advance(store, first.id, "done", { owner: ME }, NOW);
		await advance(store, second.id, "plan", { owner: ME }, NOW);
		await store.mutate(second.id, { kind: "edit", dependsOn: [first.id] }, ME, NOW);

		const swept = await sweepFinished(store, ME, NOW);
		// Archiving is one way, so the card an open card names stays: the record would lose
		// the target of a link `list` still prints.
		expect(swept.moved).toEqual([]);
		expect(swept.kept).toEqual([first.id]);
		expect(sweepText(swept)).toContain(`1 card kept: an open card still waits on #${first.id}.`);
		expect(await session.store(harness.ctx.cwd).then((s) => s.list())).toHaveLength(2);
	});

	test("/board archive runs it and reports what it left", async () => {
		const { harness, session } = board();
		const store = await harness.runtime.store(harness.ctx.cwd);
		const kept = await store.create({ title: "Finished, still waited on", paths: [] }, ME, NOW);
		const free = await store.create({ title: "Finished, nobody waits", paths: [] }, ME, NOW);
		const waiting = await store.create({ title: "Waiting one", paths: [] }, ME, NOW);
		await advance(store, kept.id, "done", { owner: ME }, NOW);
		await advance(store, free.id, "done", { owner: ME }, NOW);
		await store.mutate(waiting.id, { kind: "edit", dependsOn: [kept.id] }, ME, NOW);

		const fake = createFakePi();
		registerCommands(fake.pi, session, NO_PAGE);
		const command = fake.commands.get(BOARD_COMMAND);
		if (!command) throw new Error("the board command was not registered");
		// The harness's context, not a new one: a command works the board of its own cwd, and a
		// context built elsewhere would sweep a second, empty repository.
		const { ctx, notifications } = harness;
		await command.handler("archive", ctx as unknown as ExtensionCommandContext);

		const said = notifications.at(-1) ?? "";
		expect(said).toContain(`1 card archived: #${free.id}`);
		expect(said).toContain(`1 card kept: an open card still waits on #${kept.id}.`);
		// Asked again, the sweep has nothing to take: it names what it keeps rather than
		// reporting a silent zero, and nothing is archived twice.
		await command.handler("archive", ctx);
		const again = notifications.at(-1) ?? "";
		expect(again).toContain(`1 card kept: an open card still waits on #${kept.id}.`);
		expect(again).not.toContain("archived:");
	});
});

describe("dropped history", () => {
	/** A card that lost three notes and two lane changes to the caps. */
	function capped(overrides: Partial<Card> = {}): Card {
		return numberedCard("49", { lane: "plan", notesDropped: 3, logDropped: 2, notes: [], log: [], ...overrides });
	}

	test("a card read says what the lane cap took, beside what the note cap took", () => {
		const text = formatCard(capped(), undefined, NOW);
		expect(text).toContain("0 notes (3 earlier dropped)");
		expect(text).toContain("2 earlier lane changes dropped");
	});

	test("the rollup names the cards, because a count on the card is where nobody looks", () => {
		const cards = [capped(), boardCard("7")];
		const text = formatRound(cards, buildRound(cards, NOW));
		expect(text).toContain("dropped history: #49 (3 notes, 2 lanes) — the card keeps the count, not the text");
		// A card that lost nothing is not named: the line is about the loss, not the board.
		expect(text).not.toContain("#7 (");
	});

	test("says nothing at all on a board that dropped nothing", () => {
		const cards = [boardCard("7")];
		expect(formatRound(cards, buildRound(cards, NOW))).not.toContain("dropped history");
	});
});

describe("the archivable count", () => {
	test("counts the finished cards nothing open waits on", () => {
		const done = boardCard("1", { lane: "done" });
		const waited = boardCard("2", { lane: "done" });
		const open = boardCard("3", { lane: "plan", dependsOn: ["2"] });
		const round = buildRound([done, waited, open], NOW);
		expect(round.done.map((card) => card.id)).toEqual(["1", "2"]);
		expect(round.archivable.map((card) => card.id)).toEqual(["1"]);
	});

	test("a finished card another finished card names is archivable", () => {
		const first = boardCard("1", { lane: "done" });
		const second = boardCard("2", { lane: "done", dependsOn: ["1"] });
		const round = buildRound([first, second], NOW);
		// The dependent is finished too: nothing is held up, so nothing is kept.
		expect(round.archivable.map((card) => card.id)).toEqual(["1", "2"]);
	});
});

describe("the archive result", () => {
	/** The board tool over this suite's harness: the details a call hands the transcript block. */
	async function archiveTool() {
		const suite = board();
		registerTools(suite.harness.fake.pi, suite.harness.runtime);
		const tool = suite.harness.fake.pi.tools.get(BOARD_TOOL);
		if (!tool) throw new Error("the board tool was not registered");
		const store = await suite.harness.runtime.store(suite.harness.ctx.cwd);
		const call = async (args: Record<string, unknown>) =>
			(await tool.execute("call-1", args, undefined, undefined, suite.harness.ctx)) as {
				content: Array<{ type: string; text: string }>;
				details: BoardDetails;
			};
		return { call, store };
	}

	test("states what it moved, and the card a second call found aside", async () => {
		const { call, store } = await archiveTool();
		const card = await store.create({ title: "Finished", paths: [] }, ME, NOW);
		await advance(store, card.id, "done", { owner: ME }, NOW);
		const moved = await call({ action: "archive", card: card.id });
		expect(moved.details.archive?.moved).toEqual([card.id]);
		// Asked twice is one state: the outcome names the card already aside, and the sweep after
		// it is an empty answer — the two calls that used to draw `0 cards` over their sentence.
		const again = await call({ action: "archive", card: card.id });
		expect(again.details.archive).toEqual({ moved: [], kept: [], failed: [], already: card.id });
		const empty = await call({ action: "archive" });
		expect(resultText(empty)).toBe("No finished cards to archive.");
		expect(empty.details.archive).toEqual({ moved: [], kept: [], failed: [] });
	});

	test("states a card a live link kept, and what the sweep failed on", async () => {
		const { call, store } = await archiveTool();
		const kept = await store.create({ title: "Finished, still waited on", paths: [] }, ME, NOW);
		const waiting = await store.create({ title: "Waiting one", paths: [] }, ME, NOW);
		await advance(store, kept.id, "done", { owner: ME }, NOW);
		await store.mutate(waiting.id, { kind: "edit", dependsOn: [kept.id] }, ME, NOW);
		const swept = await call({ action: "archive" });
		// The hold is a fact the block draws, not only a sentence in the text.
		expect(swept.details.archive).toEqual({ moved: [], kept: [kept.id], failed: [] });
		expect(resultText(swept)).toContain(`1 card kept: an open card still waits on #${kept.id}.`);
	});

	test("refuses by name the card a live link kept, so the two doors agree", async () => {
		const { call, store } = await archiveTool();
		const kept = await store.create({ title: "Finished, still waited on", paths: [] }, ME, NOW);
		const waiting = await store.create({ title: "Waiting one", paths: [] }, ME, NOW);
		await advance(store, kept.id, "done", { owner: ME }, NOW);
		await store.mutate(waiting.id, { kind: "edit", dependsOn: [kept.id] }, ME, NOW);
		// The sweep keeps it, so naming it must not be the way round the same rule: archiving here
		// would leave a `dependsOn` pointing at a card no read of the board opens.
		const named = await call({ action: "archive", card: kept.id });
		expect(named.details.error).toBe(
			`#${kept.id} is finished, and #${waiting.id} (backlog) still waits on it: clear the link first, or the dependency would name a card the board no longer opens.`,
		);
		// Nothing half-applied, and the way out is one edit by the card that waits.
		expect((await store.list()).map((card) => card.id)).toContain(kept.id);
		await store.mutate(waiting.id, { kind: "edit", dependsOn: [] }, ME, NOW);
		expect((await call({ action: "archive", card: kept.id })).details.archive?.moved).toEqual([kept.id]);
	});

	test("closes an archived card's record, and keeps the one write it takes", async () => {
		const { call, store } = await archiveTool();
		const card = await store.create({ title: "Finished", paths: [] }, ME, NOW);
		await advance(store, card.id, "done", { owner: ME }, NOW);
		await call({ action: "archive", card: card.id });
		// A card set aside is history: the three operations that used to apply to one are refused,
		// and each names the one that is left. The refusal is the pile's, asked before any step, so
		// it stands even where the step would have refused for a reason of its own (`review` here).
		for (const args of [
			{ action: "note", card: card.id, text: "late" },
			{ action: "edit", card: card.id, title: "Restated" },
			{ action: "review", card: card.id, override: "closed on my instruction" },
		]) {
			const refused = await call(args);
			expect(refused.details.error).toBe(
				`#${card.id} is archived: its record is read-only, and \`drop\` removes it for good.`,
			);
		}
		// Asked again is the quiet no-op, and `drop` still ends it — nothing un-archives, so that is
		// the one way out a card set aside by mistake has.
		expect((await call({ action: "archive", card: card.id })).details.archive?.already).toBe(card.id);
		expect((await call({ action: "drop", card: card.id })).details.dropped).toBe(card.id);
	});
});
