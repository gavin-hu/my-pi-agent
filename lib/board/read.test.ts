/**
 * The reader: a v1 file mapped onto the record this build writes.
 *
 * A card file is untrusted, and the shapes it may arrive in are as old as the renames the
 * board has been through. These cases are about that map and nothing else: what it fills,
 * what it must not invent, and what it still refuses.
 */

import { describe, expect, test } from "bun:test";
import { CARD_VERSION } from "./card.ts";
import { readCard } from "./read.ts";
import { billingCard as card } from "../../test/helpers/fixtures/board.ts";

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

	test("reads the four-lane board's log words as the lanes they became", () => {
		// `todo` was the pool and `doing` was the work in hand; `blocked` and `done` kept their
		// names. A card written then is finished now, so the last entry is the age beside its
		// lane in the dialog's head — but the whole log has to pass the gate for the card to be
		// read at all.
		const { lane, ...rest } = card({ lane: "done", owner: { label: "billing-core" } });
		const read = readCard({
			...rest,
			v: 1,
			status: lane,
			log: [
				{ status: "todo", at: 1, by: "billing-core" },
				{ status: "doing", at: 2, by: "billing-core" },
				{ status: "done", at: 3, by: "billing-core" },
			],
		});
		expect(read?.log).toEqual([
			{ lane: "backlog", at: 1, by: "billing-core" },
			{ lane: "execute", at: 2, by: "billing-core" },
			{ lane: "done", at: 3, by: "billing-core" },
		]);
	});

	test("refuses a log word that is neither a lane nor a word the old board wrote", () => {
		// A guess would put the card in a lane its own history disagrees with, so the record is
		// refused and the store names the file instead.
		const { lane, ...rest } = card({ lane: "done", owner: { label: "billing-core" } });
		expect(
			readCard({ ...rest, v: 1, status: lane, log: [{ status: "paused", at: 1, by: "billing-core" }] }),
		).toBeUndefined();
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
