/**
 * The snapshot the page renders: lanes, tallies, the rollup, and the signature
 * that decides whether a frame is pushed at all.
 *
 * The point of these cases is that the page cannot invent a state: every lane
 * holds exactly its status, the counts are summed from the lanes rather than
 * counted a second way, and `sig` moves only when a revision does.
 */

import { describe, expect, test } from "bun:test";
import { type Card, signatureOf } from "./card.ts";
import { buildView } from "./view.ts";

const NOW = 5_000;

/** A card in one lane. */
function card(id: string, overrides: Partial<Card> = {}): Card {
	const base: Card = {
		v: 1,
		id,
		title: `Card ${id}`,
		status: "todo",
		paths: [],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 0,
		updatedAt: NOW,
		by: "billing-lead",
	};
	return { ...base, ...overrides };
}

const ME = { id: "s-lead", label: "billing-lead" };
const WHERE = "~/.pi/agent/board/8872d3adda0e";

describe("buildView", () => {
	test("puts every card in its own lane, in lane order", () => {
		const view = buildView({
			me: ME,
			cards: [
				card("1"),
				card("2", { status: "doing", owner: { label: "billing-core" } }),
				card("3", { status: "blocked", owner: { label: "billing-core" } }),
				card("4", { status: "done", owner: { label: "billing-core" } }),
			],
			now: NOW,
			bytes: 2_048,
			where: WHERE,
		});
		expect(view.lanes.map((lane) => lane.status)).toEqual(["todo", "doing", "blocked", "done"]);
		expect(view.lanes.map((lane) => lane.cards.map((entry) => entry.id))).toEqual([["1"], ["2"], ["3"], ["4"]]);
	});

	test("gives a card the moment it entered its lane, and nothing when its history is silent", () => {
		const view = buildView({
			me: ME,
			cards: [
				card("1", { log: [{ status: "todo", at: 4_000, by: "billing-lead" }] }),
				// A card written before the log existed.
				card("2"),
				// A log whose last entry is another lane cannot say when this one began.
				card("3", {
					status: "doing",
					owner: { label: "billing-core" },
					log: [{ status: "todo", at: 1_000, by: "billing-lead" }],
				}),
			],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		const cards = view.lanes.flatMap((lane) => lane.cards);
		expect(cards.find((entry) => entry.id === "1")?.since).toBe(4_000);
		expect(cards.find((entry) => entry.id === "2")).not.toHaveProperty("since");
		expect(cards.find((entry) => entry.id === "3")).not.toHaveProperty("since");
	});

	test("gives each card the priority it acts on, ordinary unless it says otherwise", () => {
		const view = buildView({
			me: ME,
			cards: [card("1"), card("2", { priority: "high" })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.lanes[0]?.cards.map((entry) => entry.priority)).toEqual(["normal", "high"]);
	});

	test("names what a card is blocked by, and nothing once that dependency is done", () => {
		// The page prints this line; the tool prints its own, which also names finished
		// links. Both read the same graph, so neither can invent a blocker.
		const blocked = buildView({
			me: ME,
			cards: [card("2", { status: "doing" }), card("4", { dependsOn: ["2"] })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(blocked.lanes[0]?.cards[0]?.waits).toBe("#2 (doing)");

		const cleared = buildView({
			me: ME,
			cards: [card("2", { status: "done", owner: { label: "x" } }), card("4", { dependsOn: ["2"] })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(cleared.lanes[0]?.cards[0]?.waits).toBeUndefined();
	});

	test("names what a card is holding up, and forgets a dependent that finished", () => {
		// The mirror line: the page draws it from the card it is handed, so a view that
		// dropped the field would leave the dialog saying a blocker's own cost is nothing.
		const view = buildView({
			me: ME,
			cards: [
				card("2", { status: "doing" }),
				card("4", { dependsOn: ["2"] }),
				card("5", { status: "done", dependsOn: ["2"], owner: { label: "x" } }),
			],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		const blocker = view.lanes.flatMap((lane) => lane.cards).find((entry) => entry.id === "2");
		expect(blocker?.dependents).toBe("#4 (todo)");
		// A card nothing waits on carries no field at all: absence is the fact.
		const dependent = view.lanes.flatMap((lane) => lane.cards).find((entry) => entry.id === "4");
		expect(dependent?.dependents).toBeUndefined();
	});

	test("carries a block's reason and a finished card's commit through to the lanes", () => {
		// The page draws both from the card it is handed, so a field the view dropped would
		// be a blank line where the reason and the commit belong.
		const view = buildView({
			me: ME,
			cards: [
				card("3", { status: "blocked", owner: { label: "billing-core" }, blockedBy: "legal has to sign" }),
				card("5", { status: "done", owner: { label: "billing-core" }, landed: { commit: "4af1b4a", at: NOW } }),
			],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		const blocked = view.lanes.find((lane) => lane.status === "blocked")?.cards[0];
		const done = view.lanes.find((lane) => lane.status === "done")?.cards[0];
		expect(blocked?.blockedBy).toBe("legal has to sign");
		expect(done?.landed).toEqual({ commit: "4af1b4a", at: NOW });
	});

	test("hands the rollup's groups the same card the lanes carry", () => {
		// The Team tab's queue is built from the rollup, not from the lanes: a card there
		// without `waits` reads as "nobody holds it" and loses the reason it is queued.
		const view = buildView({
			me: ME,
			cards: [card("2", { status: "doing", owner: { label: "x" } }), card("4", { dependsOn: ["2"] })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.round.unassigned.map((entry) => entry.waits)).toEqual(["#2 (doing)"]);
		expect(view.round.owners[0]?.cards[0]?.priority).toBe("normal");
	});

	test("never writes a derived field onto the card it was handed", () => {
		// The cards are the store's; a field added to one would outlive the read.
		const one = card("1");
		buildView({ me: ME, cards: [one], now: NOW, bytes: 0, where: WHERE });
		expect(Object.keys(one).sort()).toEqual([
			"by",
			"createdAt",
			"id",
			"notes",
			"notesDropped",
			"paths",
			"rev",
			"status",
			"title",
			"updatedAt",
			"v",
		]);
	});

	test("counts each lane, and the total is their sum", () => {
		const view = buildView({
			me: ME,
			cards: [card("1"), card("2"), card("3", { status: "done", owner: { label: "x" } })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.counts).toEqual({ total: 3, todo: 2, doing: 0, blocked: 0, done: 1 });
	});

	test("carries the rollup of the same cards", () => {
		const view = buildView({
			me: ME,
			cards: [card("1", { status: "doing", owner: { label: "billing-core" } })],
			now: NOW,
			bytes: 0,
			where: WHERE,
		});
		expect(view.round.owners.map((group) => group.label)).toEqual(["billing-core"]);
		expect(view.round.unplanned.map((entry) => entry.id)).toEqual(["1"]);
	});

	test("names the serving session, not the browser", () => {
		const view = buildView({ me: { label: "ad-hoc" }, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(view.me).toEqual({ label: "ad-hoc" });
	});

	test("signature starts from the cards' signature, so a bump or a drop moves it", () => {
		const one = card("1");
		const view = buildView({ me: ME, cards: [one], now: NOW, bytes: 0, where: WHERE });
		expect(view.sig.startsWith(signatureOf([one]))).toBe(true);
		const bumped = buildView({ me: ME, cards: [{ ...one, rev: 2 }], now: NOW, bytes: 0, where: WHERE });
		expect(bumped.sig).not.toBe(view.sig);
		const dropped = buildView({ me: ME, cards: [], now: NOW, bytes: 0, skipped: 0, where: WHERE });
		expect(dropped.sig).not.toBe(view.sig);
	});

	test("carries the files it could not read, so the footer can say the board is not empty", () => {
		expect(buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE }).skipped).toBe(0);
		expect(buildView({ me: ME, cards: [], now: NOW, bytes: 0, skipped: 2, where: WHERE }).skipped).toBe(2);
		// The count is in the signature too: a file that became unreadable changes what the
		// footer says, and a frame that is never pushed leaves the page saying the old thing.
		const plain = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE });
		const withSkips = buildView({ me: ME, cards: [], now: NOW, bytes: 0, skipped: 2, where: WHERE });
		expect(withSkips.sig).not.toBe(plain.sig);
	});

	test("carries the size and the directory, so an unpruned board says so", () => {
		const view = buildView({ me: ME, cards: [], now: NOW, bytes: 6_144, where: WHERE });
		expect(view.bytes).toBe(6_144);
		expect(view.where).toBe(WHERE);
	});

	test("carries the bus's sessions, marks the serving one, and states each liveness", () => {
		const view = buildView({
			me: ME,
			cards: [],
			now: NOW,
			bytes: 0,
			where: WHERE,
			roster: [
				{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 1_000, mail: 2 },
				{ id: "s-lead", label: "billing-lead", mode: "tui", lastSeen: NOW, mail: 0 },
				{ id: "s-old", label: "ops-helper", mode: "print", lastSeen: NOW - 20 * 60_000, mail: 0 },
			],
		});
		expect(view.teammates).toEqual([
			{ label: "billing-core", state: "live", seen: NOW - 1_000, mail: 2, you: false },
			{ label: "billing-lead", state: "live", seen: NOW, mail: 0, you: true },
			{ label: "ops-helper", state: "quiet", seen: NOW - 20 * 60_000, mail: 0, you: false },
		]);
	});

	test("carries whether a teammate is listening, and leaves it out when the record does not say", () => {
		const view = buildView({
			me: ME,
			cards: [],
			now: NOW,
			bytes: 0,
			where: WHERE,
			roster: [
				{
					id: "s-core",
					label: "billing-core",
					mode: "tui",
					lastSeen: NOW,
					mail: 0,
					watching: { armed: true, wake: false },
				},
				{
					id: "s-web",
					label: "billing-web",
					mode: "tui",
					lastSeen: NOW,
					mail: 0,
					watching: { armed: false, wake: false },
				},
				{ id: "s-old", label: "ops-helper", mode: "tui", lastSeen: NOW, mail: 0 },
			],
		});
		expect(view.teammates?.map((mate) => mate.listening)).toEqual([true, false, undefined]);
	});

	test("marks the reader's row from the session, because the page writes as its seat", () => {
		// The seat is what a card records and the session is who is looking: a page serving
		// as `team-lead` from `billing-lead` marks billing-lead's row, not the seat's.
		const view = buildView({
			me: { id: "board:team-lead", label: "team-lead" },
			session: { id: "s-lead", label: "billing-lead" },
			cards: [],
			now: NOW,
			bytes: 0,
			where: WHERE,
			roster: [{ id: "s-lead", label: "billing-lead", mode: "tui", lastSeen: NOW, mail: 0 }],
		});
		expect(view.me).toEqual({ id: "board:team-lead", label: "team-lead" });
		expect(view.session).toEqual({ id: "s-lead", label: "billing-lead" });
		expect(view.teammates?.map((mate) => [mate.label, mate.you])).toEqual([["billing-lead", true]]);
	});

	test("leaves the roster out when there is no bus, which is not the same as an empty one", () => {
		const absent = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(absent.teammates).toBeUndefined();
		const empty = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE, roster: [] });
		expect(empty.teammates).toEqual([]);
		// A bus appearing is news — the State column stops saying "unknown" — so the two
		// must not share a signature and leave the page without a frame.
		expect(absent.sig).not.toBe(empty.sig);
	});

	test("signature moves on a join, a quiet, and mail, and not on a heartbeat", () => {
		const at = (roster: Parameters<typeof buildView>[0]["roster"]) =>
			buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE, roster }).sig;
		const base = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 1_000, mail: 0 }]);
		const heartbeat = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 }]);
		expect(heartbeat).toBe(base);
		const joined = at([
			{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 },
			{ id: "s-new", label: "api", mode: "tui", lastSeen: NOW, mail: 0 },
		]);
		expect(joined).not.toBe(base);
		const mailed = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 1 }]);
		expect(mailed).not.toBe(base);
		const quiet = at([{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW - 20 * 60_000, mail: 0 }]);
		expect(quiet).not.toBe(base);
		// Listening is news too: a peer arming its watch changes what the row says, and the
		// frame has to be drawn again or the mark would be a frame behind.
		const listening = at([
			{
				id: "s-core",
				label: "billing-core",
				mode: "tui",
				lastSeen: NOW,
				mail: 0,
				watching: { armed: true, wake: false },
			},
		]);
		expect(listening).not.toBe(base);
	});

	test("an empty board is four empty lanes", () => {
		const view = buildView({ me: ME, cards: [], now: NOW, bytes: 0, where: WHERE });
		expect(view.lanes.map((lane) => lane.cards)).toEqual([[], [], [], []]);
		expect(view.counts.total).toBe(0);
	});
});
