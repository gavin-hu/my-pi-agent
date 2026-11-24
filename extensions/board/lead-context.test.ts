/**
 * The seat's per-turn line: what it owes, what is parked on a person, who is listening, and the hatch.
 *
 * The cases are the budget and the clauses: the hatch is on every turn, a board with nothing to sign
 * says so instead of an empty list, the pool cannot spend the room the signatures need, a block is
 * named with the decision it waits on, and a busy round clips a clause rather than cutting the line.
 */

import { describe, expect, test } from "bun:test";
import type { BoardSession } from "../../lib/workflow/session.ts";
import type { BoardStore } from "../../lib/workflow/store.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { numberedCard } from "../../test/helpers/fixtures/board.ts";
import {
	buildLeadContext,
	leadFacts,
	LEAD_CONTEXT_MARKER,
	MAX_LEAD_CHARS,
	MAX_LEAD_LINES,
	type LeadFacts,
} from "./context.ts";

const EMPTY: LeadFacts = { approve: [], review: [], untold: [], unclaimed: [], blocked: [], mail: 0, peers: [] };

describe("buildLeadContext", () => {
	test("opens with the marker and always names the hatch", () => {
		const lines = buildLeadContext(EMPTY).split("\n");
		expect(lines[0]).toStartWith(LEAD_CONTEXT_MARKER);
		expect(lines.at(-1)).toContain("/board stop");
		expect(lines.length).toBeLessThanOrEqual(MAX_LEAD_LINES);
	});

	test("says nothing to sign and no peers live rather than naming empty lists", () => {
		const text = buildLeadContext(EMPTY);
		expect(text).toContain("Yours: nothing to sign.");
		expect(text).toContain("Peers: no peers live.");
		// Nothing parked spends no line on it, and an empty inbox says nothing at all.
		expect(text).not.toContain("Blocked:");
		expect(text).not.toContain("unread");
	});

	test("names the seat's own mail, its two signatures, and the signs nobody was told", () => {
		const text = buildLeadContext({
			...EMPTY,
			mail: 2,
			approve: ["#12"],
			review: ["#9"],
			untold: ["#3"],
			peers: ["tom"],
		});
		expect(text).toContain("Yours: 2 unread · approve #12 · review #9 · untold #3.");
		expect(text).toContain("Peers: tom.");
		expect(text.split("\n")).toHaveLength(4);
	});

	test("caps the pool so forty untaken cards cannot clip the signature queue off the line", () => {
		const many = Array.from({ length: 40 }, (_, index) => `#${100 + index}`);
		const text = buildLeadContext({ ...EMPTY, approve: ["#12"], unclaimed: many });
		const yours = text.split("\n")[1] ?? "";
		// The two halves that matter survive: the signature, and a count of the pool it cannot list.
		expect(yours).toContain("approve #12");
		expect(yours).toContain("unclaimed #100, #101, #102");
		expect(yours).toContain("+37 more");
		expect(yours).not.toContain("#103");
	});

	test("names each blocked card with the decision it waits on, then counts the rest", () => {
		const one = buildLeadContext({
			...EMPTY,
			blocked: [{ ref: "#853", why: "gavin owes the seat's refusal a ruling" }],
		});
		expect(one).toContain("Blocked: #853 — gavin owes the seat's refusal a ruling.");
		// A count of zero is noise: the tail appears only when it counts.
		expect(one).not.toContain("+0 more");

		const three = buildLeadContext({
			...EMPTY,
			blocked: ["#1", "#2", "#3"].map((ref) => ({ ref, why: "a person decides" })),
		});
		expect(three).toContain("#1 — a person decides · #2 — a person decides +1 more.");
		expect(three).not.toContain("#3");
	});

	test("clips a long decision inside the ceiling instead of cutting the hatch off", () => {
		const many = Array.from({ length: 40 }, (_, index) => `#${100 + index}`);
		const text = buildLeadContext({ ...EMPTY, approve: many, review: many, unclaimed: many, peers: many });
		expect(text.length).toBeLessThanOrEqual(MAX_LEAD_CHARS);
		expect(text.split("\n")).toHaveLength(4);
		// The lists clip, and the line that says how to leave is still the last one.
		expect(text).toContain("…");
		expect(text.split("\n").at(-1)).toContain("/board stop");

		const parked = buildLeadContext({
			...EMPTY,
			blocked: Array.from({ length: 10 }, (_, index) => ({ ref: `#${index}`, why: "x".repeat(200) })),
		});
		expect(parked.length).toBeLessThanOrEqual(MAX_LEAD_CHARS);
		expect(parked.split("\n").at(-1)).toContain("/board stop");
	});
});

describe("leadFacts", () => {
	const NOW = 1_000_000;

	/** A session whose board is `cards` and whose bus is `roster`: the two reads this one makes. */
	function sessionOf(cards: ReturnType<typeof numberedCard>[], roster: RosterSession[] | undefined) {
		return {
			// `scan` is the only store method `leadFacts` calls, which is the whole of what it is handed.
			store: async () =>
				({
					scan: async () => ({ cards, skipped: [], bytes: 0 }),
					archivedCount: async () => 0,
				}) as unknown as BoardStore,
			roster: async () => roster,
			now: () => NOW,
		} satisfies Pick<BoardSession, "store" | "roster" | "now">;
	}

	const block = { kind: "decision" as const, note: "gavin owes it a ruling" };

	test("reads the round's blocked and untold groups, and the seat's own inbox", async () => {
		const { ctx } = fakeCtx({ sessionId: "s-seat", cwd: "/repo" });
		const facts = await leadFacts(
			sessionOf(
				[
					numberedCard("853", { lane: "blocked", blocked: block }),
					// A signed card nobody was told about: `told` absent is the bus never taking the message.
					numberedCard("852", {
						lane: "execute",
						planPath: "plan.md",
						review: { by: "gavin", at: NOW },
					}),
				],
				[
					{ id: "s-seat", label: "gavin", mode: "tui", lastSeen: NOW, mail: 2 },
					{ id: "s-peer", label: "tom", mode: "tui", lastSeen: NOW, mail: 0 },
				],
			),
			ctx,
		);
		expect(facts?.blocked).toEqual([{ ref: "#853", why: block.note }]);
		expect(facts?.untold).toEqual(["#852"]);
		expect(facts?.mail).toBe(2);
		// The seat's own row is not a peer: it is the seat.
		expect(facts?.peers).toEqual(["tom"]);
	});

	test("a board and a bus it cannot read are no line rather than a failed turn", async () => {
		const { ctx } = fakeCtx({ sessionId: "s-seat", cwd: "/repo" });
		const blind = {
			store: async () => {
				throw new Error("no store");
			},
			roster: async () => [],
			now: () => NOW,
		} satisfies Pick<BoardSession, "store" | "roster" | "now">;
		expect(await leadFacts(blind, ctx)).toBeUndefined();
	});

	test("no bus is no mail, not a silent zero about an inbox nobody could read", async () => {
		const { ctx } = fakeCtx({ sessionId: "s-seat", cwd: "/repo" });
		const facts = await leadFacts(sessionOf([], undefined), ctx);
		expect(facts?.mail).toBe(0);
		expect(facts?.peers).toEqual([]);
	});
});
