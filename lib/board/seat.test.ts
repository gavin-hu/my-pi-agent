/**
 * The seat: the name a page serves as, derived from the board's lead.
 *
 * The name is the lead's, and it arrives normalized — `config.ts` runs `normalizeLabel` over
 * `board.lead` — so the only rule left here is the id: two spellings of one team name must be
 * one actor, because a handover depends on a new session holding what the last one claimed.
 */

import { describe, expect, test } from "bun:test";
import { pageActor, SEAT_ID_PREFIX } from "./seat.ts";

describe("pageActor", () => {
	test("serves as the name it is given, with an id derived from it", () => {
		expect(pageActor("gavin")).toEqual({ id: `${SEAT_ID_PREFIX}gavin`, label: "gavin" });
	});

	test("the same name is always the same actor, whatever the spelling", () => {
		// A handover depends on this: a new session serving the seat must hold what the
		// previous one claimed, and `holds` compares ids first.
		expect(pageActor("Team-Lead").id).toBe(pageActor("team-lead").id);
	});

	test("keeps the name as given, so a label a person wrote is not silently lowercased", () => {
		expect(pageActor("Billing Lead").label).toBe("Billing Lead");
	});

	test("a page's id is never a session id", () => {
		expect(pageActor("billing lead").id).toStartWith(SEAT_ID_PREFIX);
	});
});
