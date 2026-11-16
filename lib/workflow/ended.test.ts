import { describe, expect, test } from "bun:test";
import { ENDED_VERSION, isEndedCard } from "./ended.ts";

/** One tombstone as the store writes it, so a case varies exactly the field it is about. */
const ended = {
	v: ENDED_VERSION,
	id: "7",
	title: "a feature",
	lane: "execute",
	by: "billing-lead",
	owner: { id: "s-1", label: "billing-core" },
	at: 1_000,
	why: "dropped",
};

describe("isEndedCard", () => {
	test("accepts the tombstone this build writes", () => {
		expect(isEndedCard(ended)).toBe(true);
	});

	test("refuses an older record's shape and a lane this build does not know", () => {
		// An older record spells `status` rather than `lane`; nothing migrates a record no code
		// path opens, so the reader refuses it rather than guessing.
		expect(isEndedCard({ ...ended, lane: undefined, status: "execute" })).toBe(false);
		expect(isEndedCard({ ...ended, lane: "paused" })).toBe(false);
	});

	test("refuses a reason other than the drop, and an id that is not an id", () => {
		expect(isEndedCard({ ...ended, why: "archived" })).toBe(false);
		expect(isEndedCard({ ...ended, id: "four" })).toBe(false);
		expect(isEndedCard({ ...ended, by: "" })).toBe(false);
		expect(isEndedCard({ ...ended, at: 1.5 })).toBe(false);
		expect(isEndedCard({ ...ended, owner: { label: "" } })).toBe(false);
		expect(isEndedCard({ ...ended, v: 2 })).toBe(false);
	});
});
