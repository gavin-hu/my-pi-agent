/**
 * A tool's `card` argument, read once: the id every spelling names, the one refusal it earns, and
 * the ref a call line prints for it.
 *
 * Its own suite because `card.test.ts` is at the suite bar and the two halves are a different
 * subject: that file settles what a card record is, and this one what the tool surface makes of
 * the `card` field — the guards that used to repeat the sentence in seven places, and the call
 * line that prefixed a spelling it had not read.
 */

import { describe, expect, test } from "bun:test";
import { cardArg, cardRefOf } from "./card.ts";

describe("cardArg", () => {
	test("names the id every spelling reaches, and words the one refusal a tool prints", () => {
		expect(cardArg("4")).toEqual({ id: "4" });
		expect(cardArg("#0004")).toEqual({ id: "4" });
		expect(cardArg(" 0042 ")).toEqual({ id: "42" });
		// Absent alone is "required": an empty or unreadable value is the other sentence, and `String`
		// is what it quotes, which is the copy the team tool had already drifted on.
		expect(cardArg(undefined)).toEqual({ error: 'card is required: pass the id, e.g. "4".' });
		expect(cardArg("")).toEqual({ error: '"" is not a card id.' });
		expect(cardArg("four")).toEqual({ error: '"four" is not a card id.' });
		expect(cardArg(4)).toEqual({ error: '"4" is not a card id.' });
	});
});

describe("cardRefOf", () => {
	test("prints the ref a result prints, and nothing for a name that is no card", () => {
		// The call line's defect: `cardRef` only prefixes, so the supported `#0001` reached it as `##0001`.
		expect(["4", "#4", "#0001", "0004"].map(cardRefOf)).toEqual(["#4", "#4", "#1", "#4"]);
		expect([undefined, "", "four", 4].map(cardRefOf)).toEqual(["", "", "", ""]);
	});
});
