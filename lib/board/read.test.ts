/**
 * The reader: a v1 file mapped onto the record this build writes.
 *
 * A card file is untrusted, and the shapes it may arrive in are as old as the renames the
 * board has been through. These cases are about that map and nothing else: what it fills,
 * what it must not invent, and what it still refuses.
 */

import { describe, expect, test } from "bun:test";
import { CARD_VERSION, type Card } from "./card.ts";
import { readCard } from "./read.ts";

/** A v2 card that passes, so each case changes exactly one thing. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: CARD_VERSION,
		id: "4",
		title: "Billing webhook accepts orders",
		lane: "backlog",
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

describe("readCard", () => {
	test("reads a v1 card, mapping the three renames onto this build's names", () => {
		// A v1 file said `status`, `plan`, and a `blockedBy`/`blocker` pair; the renames landed
		// with the contract and the lanes. The file is not rewritten, so the reader maps the
		// names, stamps the version, and hands back the record this build writes.
		const { lane, planPath, ...rest } = card({
			lane: "execute",
			owner: { id: "s1", label: "billing-core" },
			planPath: "p.md",
		});
		const read = readCard({
			...rest,
			v: 1,
			status: lane,
			plan: planPath,
			blockedBy: "legal has to sign",
			blocker: "decision",
			log: [{ status: "execute", at: 1, by: "billing-core" }],
		});
		expect(read).toMatchObject({
			v: CARD_VERSION,
			lane: "execute",
			planPath: "p.md",
			blocked: { kind: "decision", note: "legal has to sign" },
			log: [{ lane: "execute", at: 1, by: "billing-core" }],
		});
		// The old spellings do not survive the read: one record, one name.
		const keys = read === undefined ? [] : Object.keys(read);
		expect(keys.filter((key) => ["status", "plan", "blockedBy", "blocker"].includes(key))).toEqual([]);
	});

	test("keeps a v1 sentence-only block as a sentence, and invents no kind for it", () => {
		const { lane, ...rest } = card({ lane: "blocked", owner: { label: "billing-core" } });
		const read = readCard({ ...rest, v: 1, status: lane, blockedBy: "legal has to sign" });
		expect(read?.blocked).toEqual({ note: "legal has to sign" });
	});

	test("a card that already says lane keeps it, and is not repaired", () => {
		expect(readCard(card())?.lane).toBe("backlog");
		expect(readCard({ ...card(), lane: "execute", status: "backlog" })).toBeUndefined();
	});

	test("refuses what isCard refuses", () => {
		expect(readCard({ ...card(), v: 3 })).toBeUndefined();
		expect(readCard("not a card")).toBeUndefined();
		expect(readCard(undefined)).toBeUndefined();
	});
});
