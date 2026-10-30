/**
 * The card record: the field caps, the one-line flattening, and the reader that
 * decides whether a file on disk is still a card.
 *
 * The caps are asserted at the boundary because the model writes them: a title
 * that wraps a lane row, a path that climbs out of the repository, or a note that
 * grows a card file are all refused here rather than clamped somewhere later.
 */

import { describe, expect, test } from "bun:test";
import {
	CARD_VERSION,
	ENDED_VERSION,
	type Card,
	type CardTransition,
	cardRef,
	DEFAULT_PRIORITY,
	dependsOf,
	isCard,
	isEndedCard,
	laneSince,
	MAX_DEPENDS,
	MAX_LOG,
	MAX_NOTE,
	MAX_NOTES,
	MAX_PATHS,
	MAX_PATH,
	MAX_PLAN,
	MAX_TITLE,
	matchesQuery,
	MATCHES_QUERY_JS,
	normalizeCardId,
	normalizeNote,
	normalizePathHints,
	normalizePlanPath,
	normalizePriority,
	normalizeTitle,
	PRIORITIES,
	priorityOf,
	priorityRank,
} from "./card.ts";
// A card that passes, so each refusal case changes exactly one field.
import { billingCard as card } from "../../test/helpers/fixtures/board.ts";

describe("normalizeTitle", () => {
	test("keeps one sanitized line", () => {
		expect(normalizeTitle("  Billing webhook\naccepts orders  ")).toEqual({ title: "Billing webhook accepts orders" });
	});

	test("refuses an empty title", () => {
		expect(normalizeTitle("   ")).toEqual({ error: "title is required." });
		expect(normalizeTitle(undefined)).toEqual({ error: "title is required." });
	});

	test("refuses a title past the cap rather than truncating it", () => {
		expect(normalizeTitle("x".repeat(MAX_TITLE))).toEqual({ title: "x".repeat(MAX_TITLE) });
		expect(normalizeTitle("x".repeat(MAX_TITLE + 1))).toEqual({
			error: `title must be at most ${MAX_TITLE} characters.`,
		});
	});
});

describe("normalizePathHints", () => {
	test("treats an absent list as no hints", () => {
		expect(normalizePathHints(undefined)).toEqual({ paths: [] });
		expect(normalizePathHints([])).toEqual({ paths: [] });
	});

	test("normalizes separators and drops a leading ./ and a trailing slash", () => {
		expect(normalizePathHints(["./src\\billing\\"])).toEqual({ paths: ["src/billing"] });
	});

	test("deduplicates", () => {
		expect(normalizePathHints(["src/billing", "src/billing/", "./src/billing"])).toEqual({ paths: ["src/billing"] });
	});

	test("refuses an absolute path, however it is spelled", () => {
		expect(normalizePathHints(["/etc/passwd"])).toEqual({
			error: 'path "/etc/passwd" is absolute; use a repository-relative path.',
		});
		expect(normalizePathHints(["C:/Windows"])).toEqual({
			error: 'path "C:/Windows" is absolute; use a repository-relative path.',
		});
	});

	test("refuses a path that climbs out of the repository", () => {
		expect(normalizePathHints(["../elsewhere"])).toEqual({ error: 'path "../elsewhere" is outside the repository.' });
		expect(normalizePathHints(["src/../../elsewhere"])).toEqual({
			error: 'path "src/../../elsewhere" is outside the repository.',
		});
	});

	test("refuses too many hints, and a non-string one", () => {
		const many = Array.from({ length: MAX_PATHS + 1 }, (_, index) => `src/${index}`);
		expect(normalizePathHints(many)).toEqual({ error: `at most ${MAX_PATHS} paths are allowed.` });
		expect(normalizePathHints(["src", 7])).toEqual({ error: "every path must be a string." });
	});

	test("refuses an empty or over-long hint", () => {
		expect(normalizePathHints(["  "])).toEqual({ error: "every path must be a non-empty string." });
		expect(normalizePathHints(["x".repeat(MAX_PATH + 1)])).toEqual({
			error: `a path must be at most ${MAX_PATH} characters.`,
		});
	});
});

describe("normalizeNote and normalizePlanPath", () => {
	test("keep one line", () => {
		expect(normalizeNote("routes wired;\ntests next")).toEqual({ text: "routes wired; tests next" });
		expect(normalizeNote("   ")).toEqual({ error: "text is required." });
		expect(normalizeNote("x".repeat(MAX_NOTE + 1))).toEqual({
			error: `text must be at most ${MAX_NOTE} characters.`,
		});
	});

	test("a plan path is a line, not necessarily a repository path", () => {
		// The board never reads the plan, so an agent-directory path is legal here.
		expect(normalizePlanPath("~/.pi/agent/plans/abc/billing.md")).toEqual({
			path: "~/.pi/agent/plans/abc/billing.md",
		});
		expect(normalizePlanPath("")).toEqual({ error: "path is required." });
		expect(normalizePlanPath("x".repeat(MAX_PLAN + 1))).toEqual({
			error: `path must be at most ${MAX_PLAN} characters.`,
		});
	});
});

describe("normalizePriority and its accessors", () => {
	test("an absent priority is the ordinary one", () => {
		expect(normalizePriority(undefined)).toEqual({ priority: DEFAULT_PRIORITY });
		expect(priorityOf(card())).toBe(DEFAULT_PRIORITY);
	});

	test("accepts a known priority, spelled any way a person writes it", () => {
		expect(normalizePriority("high")).toEqual({ priority: "high" });
		expect(normalizePriority(" HIGH ")).toEqual({ priority: "high" });
	});

	test("refuses anything else, naming the ones allowed", () => {
		const error = { error: `priority must be one of ${PRIORITIES.join(", ")}.` };
		expect(normalizePriority("urgent")).toEqual(error);
		expect(normalizePriority(1)).toEqual(error);
	});

	test("orders a lane most urgent first", () => {
		expect(priorityRank(card({ priority: "high" }))).toBeLessThan(priorityRank(card()));
		expect(priorityRank(card())).toBeLessThan(priorityRank(card({ priority: "low" })));
	});

	test("an absent dependency list is none", () => {
		expect(dependsOf(card())).toEqual([]);
		expect(dependsOf(card({ dependsOn: ["2", "3"] }))).toEqual(["2", "3"]);
	});
});

describe("matchesQuery", () => {
	test("matches a title, a path hint, or the holder, case-insensitively", () => {
		expect(matchesQuery(card(), "WEBHOOK")).toBe(true);
		expect(matchesQuery(card(), "src/bill")).toBe(true);
		expect(matchesQuery(card({ lane: "execute", owner: { label: "billing-core" } }), "CORE")).toBe(true);
	});

	test("matches the plan, which is the file a reader is holding", () => {
		const planned = card({ planPath: "~/.pi/agent/plans/8872d3adda0e/2026-10-26-1008-the-query.md" });
		expect(matchesQuery(planned, "2026-10-26-1008")).toBe(true);
	});

	test("matches a note's text, which is where a card's reasoning lives", () => {
		const noted = card({
			notes: [
				{ by: "billing-lead", at: 2_000, text: "routes wired; tests next" },
				{ by: "billing-core", at: 3_000, text: "waiting on the CHANGELOG entry" },
			],
		});
		expect(matchesQuery(noted, "changelog")).toBe(true);
		expect(matchesQuery(noted, "routes")).toBe(true);
	});

	test("matches everything when the query is blank", () => {
		expect(matchesQuery(card(), "  ")).toBe(true);
	});

	test("does not match a card it does not name", () => {
		expect(matchesQuery(card(), "retry branches")).toBe(false);
	});
});

describe("MATCHES_QUERY_JS", () => {
	test("is the same body, safe to splice into a script", () => {
		// The page's filter runs this source; a backtick or an interpolation would end the
		// template it lands in, and the failure would be a board that never filters.
		expect(MATCHES_QUERY_JS).toBe(String(matchesQuery));
		expect(MATCHES_QUERY_JS).not.toContain("`");
		expect(MATCHES_QUERY_JS).not.toContain("${");
	});

	test("answers what the module answers", () => {
		const browserMatches = new Function(`return (${MATCHES_QUERY_JS});`)() as (card: Card, query: string) => boolean;
		const worked = card({
			lane: "execute",
			owner: { label: "billing-core" },
			planPath: "~/.pi/agent/plans/8872d3adda0e/the-query.md",
			notes: [{ by: "billing-core", at: 2_000, text: "waiting on the gateway" }],
		});
		const queries = ["", "  ", "WEBHOOK", "src/bill", "CORE", "8872d3adda0e", "gateway", "changelog"];
		for (const query of queries) {
			expect([query, browserMatches(worked, query)]).toEqual([query, matchesQuery(worked, query)]);
		}
	});
});

describe("normalizeCardId", () => {
	test("accepts a bare or hashed id", () => {
		expect(normalizeCardId("4")).toBe("4");
		expect(normalizeCardId("#4")).toBe("4");
		expect(normalizeCardId(" 0042 ")).toBe("0042");
	});

	test("refuses anything else", () => {
		expect(normalizeCardId("four")).toBeUndefined();
		expect(normalizeCardId("4a")).toBeUndefined();
		expect(normalizeCardId("")).toBeUndefined();
		expect(normalizeCardId(4)).toBeUndefined();
	});

	test("renders the way the page and the transcript write it", () => {
		expect(cardRef("4")).toBe("#4");
	});
});

describe("laneSince", () => {
	test("answers with the moment the current lane was entered", () => {
		expect(laneSince(card({ log: [{ lane: "backlog", at: 4_000, by: "billing-lead" }] }))).toBe(4_000);
		const moved = card({
			lane: "execute",
			owner: { label: "billing-core" },
			log: [
				{ lane: "backlog", at: 1_000, by: "billing-lead" },
				{ lane: "execute", at: 2_000, by: "billing-core" },
			],
		});
		expect(laneSince(moved)).toBe(2_000);
	});

	test("says nothing when the history is silent", () => {
		// A card written before the log existed, and one whose entry for the lane it is in
		// has dropped off the front of a full log: both are absence, not a guess from
		// `updatedAt`, which moves on every write.
		expect(laneSince(card())).toBeUndefined();
		expect(laneSince(card({ lane: "execute", owner: { label: "c" }, log: [] }))).toBeUndefined();
		expect(
			laneSince(card({ lane: "execute", owner: { label: "c" }, log: [{ lane: "backlog", at: 1_000, by: "lead" }] })),
		).toBeUndefined();
	});
});

describe("isEndedCard", () => {
	test("holds the record a dropped card leaves to the shape this build writes", () => {
		// The pile is a ledger nothing reads back, so the validator is the only statement of
		// its shape: it carries its own version, which does not move when the card record
		// does, and a record written before the lane was called a lane spells `status` and is
		// not migrated, because no code path opens it.
		const ended = {
			v: ENDED_VERSION,
			id: "4",
			title: "Billing webhook",
			lane: "execute",
			by: "billing-lead",
			owner: { id: "s1", label: "billing-core" },
			at: 1_000,
			why: "dropped",
		};
		expect(isEndedCard(ended)).toBe(true);
		expect(isEndedCard({ ...ended, lane: undefined, status: "execute" })).toBe(false);
		expect(isEndedCard({ ...ended, why: "archived" })).toBe(false);
		expect(isEndedCard({ ...ended, id: "four" })).toBe(false);
	});
});

describe("isCard", () => {
	test("accepts a card this build writes", () => {
		expect(isCard(card({ log: [{ lane: "backlog", at: 1_000, by: "billing-lead" }], logDropped: 0 }))).toBe(true);
		expect(isCard(card())).toBe(true);
		expect(isCard(card({ lane: "execute", owner: { id: "s1", label: "billing-core" } }))).toBe(true);
		expect(isCard(card({ lane: "done", owner: { label: "billing-core" }, planPath: "p.md" }))).toBe(true);
	});

	test("refuses a log this build cannot trust", () => {
		const entry: CardTransition = { lane: "execute", at: 1_000, by: "billing-core" };
		expect(isCard(card({ log: [entry] }))).toBe(true);
		// A lane the build does not know, a moment that is not a moment, and a writer with
		// no name are each a record this reader refuses rather than repairs.
		expect(isCard({ ...card(), log: [{ ...entry, lane: "paused" }] })).toBe(false);
		expect(isCard({ ...card(), log: [{ ...entry, at: 1.5 }] })).toBe(false);
		expect(isCard({ ...card(), log: [{ ...entry, by: "" }] })).toBe(false);
		expect(isCard({ ...card(), log: Array.from({ length: MAX_LOG + 1 }, () => entry) })).toBe(false);
		expect(isCard({ ...card(), logDropped: -1 })).toBe(false);
	});

	test("refuses another schema version", () => {
		expect(isCard({ ...card(), v: 3 })).toBe(false);
		expect(isCard({ ...card(), v: undefined })).toBe(false);
	});

	test("refuses a malformed id, title, or lane", () => {
		expect(isCard({ ...card(), id: "four" })).toBe(false);
		expect(isCard({ ...card(), id: 4 })).toBe(false);
		expect(isCard({ ...card(), title: "" })).toBe(false);
		expect(isCard({ ...card(), lane: "archived" })).toBe(false);
	});

	test("refuses an owner that is not one", () => {
		expect(isCard({ ...card({ lane: "execute" }), owner: {} })).toBe(false);
		expect(isCard({ ...card({ lane: "execute" }), owner: { label: "" } })).toBe(false);
		expect(isCard({ ...card({ lane: "execute" }), owner: { label: "x", id: 7 } })).toBe(false);
	});

	test("holds the two ownership invariants: todo has no owner, every other lane has one", () => {
		expect(isCard(card({ owner: { label: "billing-core" } }))).toBe(false);
		for (const lane of ["execute", "blocked", "done"] as const) {
			expect(isCard(card({ lane })), lane).toBe(false);
		}
	});

	test("accepts a recorded block and a landing, and an older card with neither", () => {
		const block = { kind: "decision" as const, note: "legal has to sign" };
		expect(isCard(card({ lane: "blocked", owner: { label: "billing-core" }, blocked: block }))).toBe(true);
		// A block may hold the sentence alone: that is what a card written before the kind reads as.
		expect(isCard(card({ lane: "blocked", owner: { label: "billing-core" }, blocked: { note: "legal" } }))).toBe(true);
		expect(isCard(card({ lane: "done", owner: { label: "billing-core" }, landed: { commit: "4af1b4a", at: 1 } }))).toBe(
			true,
		);
		// The two fields are optional, so every card written before them still reads.
		expect(isCard(card())).toBe(true);
	});

	test("refuses a block that is empty, unknown, or over the cap, and a landing that is not one", () => {
		const blocked = { lane: "blocked" as const, owner: { label: "billing-core" } };
		expect(isCard({ ...card(blocked), blocked: {} })).toBe(false);
		expect(isCard({ ...card(blocked), blocked: { kind: "paused" } })).toBe(false);
		expect(isCard({ ...card(blocked), blocked: { note: "" } })).toBe(false);
		expect(isCard({ ...card(blocked), blocked: { note: "x".repeat(201) } })).toBe(false);
		expect(isCard({ ...card(blocked), blocked: 7 })).toBe(false);
		const done = { lane: "done" as const, owner: { label: "billing-core" } };
		expect(isCard({ ...card(done), landed: { commit: "", at: 1 } })).toBe(false);
		expect(isCard({ ...card(done), landed: { commit: "not a sha", at: 1 } })).toBe(false);
		expect(isCard({ ...card(done), landed: { commit: "4af1b4a" } })).toBe(false);
	});

	test("refuses more notes than a card keeps, and a malformed one", () => {
		const notes = Array.from({ length: MAX_NOTES + 1 }, (_, at) => ({ by: "x", at, text: "n" }));
		expect(isCard(card({ notes }))).toBe(false);
		expect(isCard(card({ notes: [{ by: "x", at: 1, text: 2 } as unknown as Card["notes"][number]] }))).toBe(false);
	});

	test("accepts a priority and a dependency list, and an older card with neither", () => {
		expect(isCard(card({ priority: "high" }))).toBe(true);
		expect(isCard(card({ dependsOn: ["2", "3"] }))).toBe(true);
	});

	test("refuses a priority it does not know, and a dependency list that is not one", () => {
		expect(isCard({ ...card(), priority: "urgent" })).toBe(false);
		expect(isCard({ ...card(), priority: 1 })).toBe(false);
		expect(isCard({ ...card(), dependsOn: "2" })).toBe(false);
		expect(isCard({ ...card(), dependsOn: ["2", "2"] })).toBe(false);
		expect(isCard({ ...card(), dependsOn: ["#2"] })).toBe(false);
		expect(isCard({ ...card(), dependsOn: Array.from({ length: MAX_DEPENDS + 1 }, (_, at) => String(at)) })).toBe(
			false,
		);
	});

	test("refuses a revision or a clock that is not one", () => {
		expect(isCard({ ...card(), rev: 0 })).toBe(false);
		expect(isCard({ ...card(), rev: 1.5 })).toBe(false);
		expect(isCard({ ...card(), updatedAt: "now" })).toBe(false);
	});

	test("refuses a non-object", () => {
		for (const value of [null, undefined, 4, "card", []]) expect(isCard(value)).toBe(false);
	});
});

describe("the recorded offer", () => {
	test("round-trips as a whole number, and reads as absent when it is missing", () => {
		const base = {
			v: CARD_VERSION,
			id: "2",
			title: "Retry branches",
			lane: "backlog",
			paths: [],
			notes: [],
			notesDropped: 0,
			rev: 1,
			createdAt: 1,
			updatedAt: 2,
			by: "billing-lead",
		};
		expect(isCard(base)).toBe(true);
		expect(isCard({ ...base, offeredAt: 5_000 })).toBe(true);
		// A pre-existing card has no field, and the field is optional, so its absence needs no
		// version: a clock fragment or a string is what this build cannot read.
		for (const bad of [1.5, "5000", null]) {
			expect(isCard({ ...base, offeredAt: bad })).toBe(false);
		}
	});
});
