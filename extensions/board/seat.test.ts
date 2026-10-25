/**
 * The seat: the fixed name a page serves as.
 *
 * The id is derived from the name, so the cases that matter are the ones a handover
 * depends on — the same name is always the same actor, and a name that needs flattening
 * is flattened before the id is derived from it.
 */

import { describe, expect, test } from "bun:test";
import { MAX_LABEL } from "../../lib/session-label.ts";
import { DEFAULT_SEAT, pageActor, SEAT_ID_PREFIX } from "./seat.ts";

describe("pageActor", () => {
	test("serves as the seat by default, with an id derived from the name", () => {
		expect(pageActor()).toEqual({ id: `${SEAT_ID_PREFIX}${DEFAULT_SEAT}`, label: DEFAULT_SEAT });
		expect(DEFAULT_SEAT).toBe("team-lead");
	});

	test("the same name is always the same actor, whatever the spelling", () => {
		// A handover depends on this: a new session serving the seat must hold what the
		// previous one claimed, and `holds` compares ids first.
		expect(pageActor("Team-Lead").id).toBe(pageActor("team-lead").id);
		expect(pageActor("  team-lead  ").id).toBe(pageActor().id);
	});

	test("keeps the name as given, so a label a person wrote is not silently lowercased", () => {
		expect(pageActor("Billing Lead").label).toBe("Billing Lead");
	});

	test("an empty name falls back to the seat rather than leaving a blank chip", () => {
		expect(pageActor("   ")).toEqual(pageActor(DEFAULT_SEAT));
	});

	test("a name that needs flattening is flattened before the id is taken from it", () => {
		const actor = pageActor("billing\nlead");
		expect(actor.label).toBe("billing lead");
		expect(actor.id).toBe(`${SEAT_ID_PREFIX}billing lead`);
	});

	test("a page's id is never a session id, and a long name is capped before it is one", () => {
		expect(pageActor("x".repeat(MAX_LABEL + 10)).label).toHaveLength(MAX_LABEL);
		expect(pageActor().id).toStartWith(SEAT_ID_PREFIX);
	});
});
