/**
 * The rollup as text: the headline a lead reads first, then one line per group.
 *
 * These sentences are shown twice — in the `board` tool's result and in `team`'s
 * `/team` — so the cases here are about the facts they carry and the order they carry
 * them in, not about spacing.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "./card.ts";
import { buildRound } from "./round.ts";
import { minuteOldCards } from "../../test/helpers/fixtures/board.ts";
import {
	formatRound,
	HISTORY_LINE_JS,
	HISTORY_OWNER_JS,
	historyLine,
	HOLDING_OF_JS,
	holdingLine,
	holdingOf,
	isHistoryOwner,
	liveLabelOf,
	PLURAL_JS,
	plural,
	RAN_CLAUSE_JS,
	ranClause,
	type RosterLabel,
	withLiveOwner,
} from "./round-text.ts";
import { buildView } from "./view.ts";

const NOW = 1_760_000_000_000;
const UNWRITTEN_MS = 30 * 60 * 1_000;

// A card a minute old, as the store would have written it.
const card = minuteOldCards(NOW);

describe("formatRound", () => {
	test("counts what a lead decides on, then names each group's cards", () => {
		const cards = [
			card("1"),
			card("2", { lane: "execute", owner: { label: "billing-core" } }),
			card("3", {
				lane: "blocked",
				owner: { label: "billing-core" },
				notes: [{ by: "x", at: NOW, text: "gateway" }],
			}),
			card("4", { lane: "done", owner: { label: "billing-other" } }),
		];
		// The groups overlap on purpose: #2 is live for its owner and unplanned for the
		// lead, and one line each is what says both.
		expect(formatRound(cards, buildRound(cards, NOW)).split("\n")).toEqual([
			"2 owners · 4 features · 1 unassigned · 0 unplanned · 0 awaiting approval · 1 awaiting review · 1 blocked · 0 unwritten · 1 done, 1 archivable",
			"billing-core (2): #2 execute, #3 blocked",
			"billing-other (0 live, 1 done)",
			"unassigned (1): #1 backlog",
			"unreviewed (1): #2 execute",
			"blocked (1): #3 blocked — gateway",
			"done (1): #4 done",
		]);
	});

	test("counts the closes made by instruction on the count they qualify", () => {
		const cards = [
			card("4", {
				lane: "done",
				owner: { label: "billing-other" },
				review: { by: "you", at: NOW, byInstruction: "closed on my instruction" },
			}),
			card("5", { lane: "done", owner: { label: "billing-other" }, review: { by: "lead", at: NOW } }),
		];
		// The card keeps its own sentence either way: this is the one line a lead scans before
		// opening anything, so it says how many of the history were not signed at the gate.
		expect(formatRound(cards, buildRound(cards, NOW)).split("\n")[0]).toContain(
			"2 done, 1 by instruction, 2 archivable",
		);
	});

	test("an owner who finished everything keeps its line and its count", () => {
		const cards = [card("4", { lane: "done", owner: { label: "billing-other" } })];
		const lines = formatRound(cards, buildRound(cards, NOW)).split("\n");
		expect(lines).toContain("billing-other (0 live, 1 done)");
	});

	test("names a contract that is still missing a line, which is the one a lead looks at", () => {
		const cards = [card("2", { lane: "plan", owner: { label: "billing-core" } })];
		expect(formatRound(cards, buildRound(cards, NOW))).toContain("unplanned (1): #2 plan");
	});

	test("names a complete contract nobody has read, as its own queue", () => {
		const cards = [
			card("2", {
				lane: "plan",
				owner: { label: "billing-core" },
				planPath: "plans/demo.md",
				contract: { goal: "g", acceptance: "a", scopeOut: "s", verify: "bun run check" },
			}),
		];
		expect(formatRound(cards, buildRound(cards, NOW))).toContain("unapproved (1): #2 plan");
	});

	test("an unwritten card in flight is not unplanned-by-accident", () => {
		const stale = card("2", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });
		const aged = { ...stale, updatedAt: NOW - UNWRITTEN_MS - 1 };
		expect(formatRound([aged], buildRound([aged], NOW))).toContain("unwritten (1): #2 execute");
	});

	test("names an executing card nobody has spot-checked, before the card is unwritten", () => {
		// The lead's half of the flow is two signatures, so the text states both queues: this one
		// is owed from the minute the card enters `execute`.
		const fresh = card("2", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });
		const lines = formatRound([fresh], buildRound([fresh], NOW)).split("\n");
		expect(lines).toContain("unreviewed (1): #2 execute");
		expect(lines[0]).toContain("1 awaiting review");
		expect(lines).not.toContain("unwritten (1): #2 execute");
	});

	test("an empty board is a headline of zeroes, not a refusal", () => {
		expect(formatRound([], buildRound([], NOW))).toBe(
			"0 owners · 0 features · 0 unassigned · 0 unplanned · 0 awaiting approval · 0 awaiting review · 0 blocked · 0 unwritten · 0 done",
		);
	});
});

describe("the owners who are only history", () => {
	/** A bus that has recorded `labels`. */
	const bus = (...labels: string[]): RosterLabel[] => labels.map((label) => ({ label }));
	const finished = [
		card("1", { lane: "done", owner: { label: "billing-old" } }),
		card("2", { lane: "done", owner: { label: "billing-older" } }),
		card("3", { lane: "done", owner: { label: "billing-older" } }),
	];
	const working = card("4", { lane: "execute", owner: { label: "billing-core" }, planPath: "p.md" });

	test("are one line, in the Team tab's own words, where they were a line each", () => {
		const cards = [...finished, working];
		const lines = formatRound(cards, buildRound(cards, NOW), bus("billing-core")).split("\n");
		expect(lines).toContain("2 owners with no record · 3 done");
		expect(lines.some((line) => line.startsWith("billing-old"))).toBe(false);
		// The fold is a line of the owner block, so the queue still follows it.
		expect(lines.indexOf("2 owners with no record · 3 done")).toBeLessThan(
			lines.indexOf("done (3): #1 done, #2 done, #3 done"),
		);
	});

	test("are named one at a time when the bus has no record of nobody", () => {
		// No roster is "we cannot say", not "there is no record": a board with the bus unloaded
		// prints what it printed before the fold existed.
		const cards = [...finished, working];
		const lines = formatRound(cards, buildRound(cards, NOW)).split("\n");
		expect(lines.some((line) => line.startsWith("billing-old (0 live, 1 done)"))).toBe(true);
		expect(lines.some((line) => line.startsWith("2 owners with no record"))).toBe(false);
	});

	test("keep a row when the bus knows them, even holding nothing", () => {
		const lines = formatRound(finished, buildRound(finished, NOW), bus("billing-old", "billing-older")).split("\n");
		expect(lines).toContain("billing-old (0 live, 1 done)");
		expect(lines).toContain("billing-older (0 live, 2 done)");
		expect(lines.some((line) => line.includes("with no record"))).toBe(false);
	});

	test("keep a row when they hold a card, because the queue is reporting its work", () => {
		// An owner the bus has no record of and that holds nothing is history; one holding a card
		// is the row a lead acts on, and folding it would hide a free card behind a count.
		const lines = formatRound([working], buildRound([working], NOW), bus()).split("\n");
		expect(lines).toContain("billing-core (1): #4 execute");
	});

	test("read as one owner when there is only one", () => {
		const one = [card("1", { lane: "done", owner: { label: "billing-old" } })];
		expect(formatRound(one, buildRound(one, NOW), bus())).toContain("1 owner with no record · 1 done");
	});

	test("are counted once, whatever they finished", () => {
		expect(isHistoryOwner("billing-old", 0, bus())).toBe(true);
		expect(isHistoryOwner("Billing-Old", 0, bus("billing-old"))).toBe(false);
		expect(isHistoryOwner("billing-core", 1, bus())).toBe(false);
		expect(isHistoryOwner("billing-old", 0, undefined)).toBe(false);
	});
});

describe("PLURAL_JS", () => {
	test("is the same body, safe to splice into a script", () => {
		// The page's bundle carries this string; a backtick or an interpolation would end
		// the template it lands in, and the failure would be a blank board.
		expect(PLURAL_JS).toBe(String(plural));
		expect(PLURAL_JS).not.toContain("`");
		expect(PLURAL_JS).not.toContain("${");
	});

	test("answers what the module answers", () => {
		const browserPlural = new Function(`return (${PLURAL_JS});`)() as (count: number, noun: string) => string;
		for (const [count, noun] of [
			[0, "note"],
			[1, "card"],
			[2, "cards"],
		] as const) {
			expect(browserPlural(count, noun)).toBe(plural(count, noun));
		}
	});
});

describe("plural", () => {
	test("adds one s, and only one", () => {
		expect(plural(1, "owner")).toBe("1 owner");
		expect(plural(0, "note")).toBe("0 notes");
	});
});

describe("the run clause three surfaces print", () => {
	const VERIFY = "bun run check";

	test("names the command, the tree it ran in, and the commit and branch there", () => {
		// One sentence for the transcript's card, the person's line, and the page's dialog. The tree is
		// the half a commit cannot say: the same commit backs a branch and the checkout it was cut from.
		expect(
			ranClause({ cmd: VERIFY, exit: 0, at: NOW, root: "/repo", sha: "1d3a8ce3", branch: "main", checkout: true }),
		).toBe(" · ran `bun run check` in the checkout (exit 0, main @ 1d3a8ce3)");
		// A worktree keeps its path: it is the tree a reviewer has to enter to reproduce a red.
		expect(ranClause({ cmd: VERIFY, exit: 0, at: NOW, root: "/repo/.pi/worktrees/x", branch: "worktree-x" })).toBe(
			" · ran `bun run check` in /repo/.pi/worktrees/x (exit 0, worktree-x)",
		);
	});

	test("reads a record written before the tree had a name exactly as it did", () => {
		// The compatibility the field must not spend: an old sign prints its path and its commit, with no
		// new word in it, and a record with nothing at all prints the command and the exit.
		expect(ranClause({ cmd: VERIFY, exit: 0, at: NOW, root: "/repo", sha: "1d3a8ce3" })).toBe(
			" · ran `bun run check` in /repo (exit 0, 1d3a8ce3)",
		);
		expect(ranClause({ cmd: VERIFY, exit: 1, at: NOW })).toBe(" · ran `bun run check` (exit 1)");
		expect(ranClause(undefined)).toBe("");
	});

	test("is the same body the browser receives, safe to splice into a script", () => {
		expect(RAN_CLAUSE_JS).toBe(String(ranClause));
		expect(RAN_CLAUSE_JS).not.toContain("${");
		const browserClause = new Function(`return (${RAN_CLAUSE_JS});`)() as typeof ranClause;
		const run = { cmd: VERIFY, exit: 0, at: NOW, root: "/repo", branch: "main", checkout: true } as const;
		expect(browserClause(run)).toBe(ranClause(run));
	});
});

describe("the history line the browser receives", () => {
	test("is the same body, safe to splice into a script", () => {
		// The page's history row and this line are one sentence, so the count of owners and the
		// work they finished cannot read two ways.
		expect(HISTORY_LINE_JS).toBe(String(historyLine));
		expect(HISTORY_OWNER_JS).toBe(String(isHistoryOwner));
		for (const source of [HISTORY_LINE_JS, HISTORY_OWNER_JS]) {
			expect(source).not.toContain("`");
			expect(source).not.toContain("${");
		}
	});

	test("answers what the module answers, with `plural` in the fragment's scope", () => {
		// The body calls `plural` rather than carrying a second wording for `1 owner`, the same
		// way the fragment it is spliced into holds one `plural` for the whole page.
		const browserLine = new Function("plural", `return (${HISTORY_LINE_JS});`)(plural) as (
			owners: number,
			done: number,
		) => string;
		const browserPlural = new Function(`return (${PLURAL_JS});`)() as (count: number, noun: string) => string;
		expect(browserLine(1, 1)).toBe(historyLine(1, 1));
		expect(browserLine(2, 3)).toBe("2 owners with no record · 3 done");
		expect(historyLine(1, 1)).toContain(browserPlural(1, "owner"));
		const browserHistory = new Function(`return (${HISTORY_OWNER_JS});`)() as (
			label: string,
			held: number,
			roster: readonly RosterLabel[] | undefined,
		) => boolean;
		for (const [label, held, roster] of [
			["billing-old", 0, []],
			["billing-core", 0, [{ label: "billing-core" }]],
			["billing-old", 2, []],
			["billing-old", 0, undefined],
		] as const) {
			expect(browserHistory(label, held, roster)).toBe(isHistoryOwner(label, held, roster));
		}
	});
});

describe("what a session is holding", () => {
	test("names the one card, counts the rest, and says idle for none", () => {
		// One row says what the next verb takes and how much else there is, rather than a list
		// that would push the other teammates off a one-line row.
		expect(holdingOf([])).toBe("idle");
		expect(holdingOf([card("162", { lane: "plan" })])).toBe("#162 plan");
		expect(holdingOf([card("162", { lane: "plan" }), card("163"), card("164", { lane: "blocked" })])).toBe(
			"#162 plan +2",
		);
	});

	test("pairs the label with it, so a name and a count are one sentence", () => {
		expect(holdingLine("helen", [card("162", { lane: "plan" })])).toBe("helen — #162 plan");
		expect(holdingLine("helen", [])).toBe("helen — idle");
	});

	test("crosses to the page as the same body, safe to splice into a script", () => {
		expect(HOLDING_OF_JS).toBe(String(holdingOf));
		expect(HOLDING_OF_JS).not.toContain("`");
		expect(HOLDING_OF_JS).not.toContain("${");
		const browserHolding = new Function(`return (${HOLDING_OF_JS});`)() as (cards: readonly Card[]) => string;
		expect(browserHolding([card("162", { lane: "plan" })])).toBe(holdingOf([card("162", { lane: "plan" })]));
	});
});

describe("the name a card's owner shows", () => {
	/** A card claimed by one session, which the card remembers as the name it wrote under. */
	const claimed = (id = "4") => card(id, { lane: "execute", owner: { id: "s-core", label: "team-agent-score" } });

	test("answers the record the bus holds for the owner's id", () => {
		// `/team join bob` moves the record and no card: the id is still the one `holds` decided, so
		// it is still the one the reader resolves the name through.
		const roster = [{ id: "s-core", label: "bob" }];
		expect(liveLabelOf({ id: "s-core", label: "team-agent-score" }, roster)).toBe("bob");
	});

	test("keeps the card's label when no record names the id", () => {
		const roster = [{ id: "s-other", label: "bob" }];
		// A pruned record, or a session that never joined: the bus has no word, so the card's stands.
		expect(liveLabelOf({ id: "s-core", label: "team-agent-score" }, roster)).toBe("team-agent-score");
		// A handoff the bus could not name records no id, and nothing may invent one for it.
		expect(liveLabelOf({ label: "team-agent-score" }, roster)).toBe("team-agent-score");
		expect(liveLabelOf({ id: "s-core", label: "team-agent-score" }, undefined)).toBe("team-agent-score");
	});

	test("does not let another session wearing the label answer for the id", () => {
		// A label is reusable the moment its holder stops, which is why `holds` compares ids: a new
		// session called `team-agent-score` is not the one this card belongs to.
		expect(liveLabelOf({ id: "s-core", label: "team-agent-score" }, [{ id: "s-new", label: "team-agent-score" }])).toBe(
			"team-agent-score",
		);
	});

	test("names the card's owner by the roster, and changes nothing else", () => {
		const owner = claimed();
		const named = withLiveOwner(owner, [{ id: "s-core", label: "bob" }]);
		expect(named.owner).toEqual({ id: "s-core", label: "bob" });
		// A display copy, not a new record: the revision, the lane, and the notes travel as they were.
		expect({ ...named, owner: undefined }).toEqual({ ...owner, owner: undefined });
		// The card itself is untouched, so a rename never reaches a file.
		expect(owner.owner?.label).toBe("team-agent-score");
	});

	test("hands back the same card when the name already agrees, or nobody owns it", () => {
		const owner = claimed();
		expect(withLiveOwner(owner, [{ id: "s-core", label: "team-agent-score" }])).toBe(owner);
		expect(withLiveOwner(owner, undefined)).toBe(owner);
		const loose = card("5");
		expect(withLiveOwner(loose, [{ id: "s-core", label: "bob" }])).toBe(loose);
		const unresolved = card("6", {
			lane: "execute",
			owner: { label: "team-agent-score", handoff: { at: NOW, unresolved: true } },
		});
		expect(withLiveOwner(unresolved, [{ id: "s-core", label: "bob" }])).toBe(unresolved);
	});

	test("reaches the page's snapshot, which is where the roster and the cards meet", () => {
		const view = buildView({
			me: { id: "s-lead", label: "billing-lead" },
			cards: [claimed("1")],
			now: NOW,
			bytes: 0,
			where: "~/.pi/agent/board/8872d3adda0e",
			repo: "my-pi-agent",
			root: "/Users/someone/my-pi-agent",
			roster: [{ id: "s-core", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 }],
		});
		// The lane carries the resolved name, and the rollup groups under it — which is the join the
		// Agents column makes, so one session draws one row.
		expect(view.lanes.find((lane) => lane.key === "execute")?.cards[0]?.owner).toEqual({
			id: "s-core",
			label: "billing-core",
		});
		expect(view.round.owners.map((group) => group.label)).toEqual(["billing-core"]);
	});
});
