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
	type Card,
	cardRef,
	DEFAULT_PRIORITY,
	dependsOf,
	isCard,
	MAX_DEPENDS,
	MAX_NOTE,
	MAX_NOTES,
	MAX_PATHS,
	MAX_PATH,
	MAX_PLAN,
	MAX_TITLE,
	matchesQuery,
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

/** A card that passes, so each refusal case changes exactly one field. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id: "4",
		title: "Billing webhook accepts orders",
		status: "todo",
		paths: ["src/billing"],
		notes: [],
		notesDropped: 0,
		rev: 1,
		createdAt: 1_000,
		updatedAt: 1_000,
		by: "billing-lead",
		...overrides,
	};
}

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
		expect(matchesQuery(card({ status: "doing", owner: { label: "billing-core" } }), "CORE")).toBe(true);
	});

	test("matches everything when the query is blank", () => {
		expect(matchesQuery(card(), "  ")).toBe(true);
	});

	test("does not match a card it does not name", () => {
		expect(matchesQuery(card(), "retry branches")).toBe(false);
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

describe("isCard", () => {
	test("accepts a card this build writes", () => {
		expect(isCard(card())).toBe(true);
		expect(isCard(card({ status: "doing", owner: { id: "s1", label: "billing-core" } }))).toBe(true);
		expect(isCard(card({ status: "done", owner: { label: "billing-core" }, plan: "p.md" }))).toBe(true);
	});

	test("refuses another schema version", () => {
		expect(isCard({ ...card(), v: 2 })).toBe(false);
		expect(isCard({ ...card(), v: undefined })).toBe(false);
	});

	test("refuses a malformed id, title, or lane", () => {
		expect(isCard({ ...card(), id: "four" })).toBe(false);
		expect(isCard({ ...card(), id: 4 })).toBe(false);
		expect(isCard({ ...card(), title: "" })).toBe(false);
		expect(isCard({ ...card(), status: "archived" })).toBe(false);
	});

	test("refuses an owner that is not one", () => {
		expect(isCard({ ...card({ status: "doing" }), owner: {} })).toBe(false);
		expect(isCard({ ...card({ status: "doing" }), owner: { label: "" } })).toBe(false);
		expect(isCard({ ...card({ status: "doing" }), owner: { label: "x", id: 7 } })).toBe(false);
	});

	test("holds the two ownership invariants: todo has no owner, every other lane has one", () => {
		expect(isCard(card({ owner: { label: "billing-core" } }))).toBe(false);
		for (const status of ["doing", "blocked", "done"] as const) {
			expect(isCard(card({ status })), status).toBe(false);
		}
	});

	test("accepts a recorded block and a landing, and an older card with neither", () => {
		expect(isCard(card({ status: "blocked", owner: { label: "billing-core" }, blockedBy: "legal has to sign" }))).toBe(
			true,
		);
		expect(
			isCard(card({ status: "done", owner: { label: "billing-core" }, landed: { commit: "4af1b4a", at: 1 } })),
		).toBe(true);
		// The two fields are optional, so every card written before them still reads.
		expect(isCard(card())).toBe(true);
	});

	test("refuses a block that is empty or over the cap, and a landing that is not one", () => {
		const blocked = { status: "blocked" as const, owner: { label: "billing-core" } };
		expect(isCard({ ...card(blocked), blockedBy: "" })).toBe(false);
		expect(isCard({ ...card(blocked), blockedBy: "x".repeat(201) })).toBe(false);
		expect(isCard({ ...card(blocked), blockedBy: 7 })).toBe(false);
		const done = { status: "done" as const, owner: { label: "billing-core" } };
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
