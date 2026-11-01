/**
 * The token table: who a review's bearer token names.
 *
 * `createTokens` is what every review route asks "who is this" of — the router's `caller` is
 * its `get` — and it had no suite. The cases are the module header's three rules, one token
 * per role, a removed token forgotten, a name bound elsewhere visible, plus the refusal every
 * request starts with.
 */

import { describe, expect, test } from "bun:test";
import type { ReviewCaller } from "./types.ts";
import { createTokens, type TokenTable } from "./web-tokens.ts";

/** The caller a token names, as the session binds a name to it: `get` answers the stored object. */
function callerOf(tokens: TokenTable, token: string): ReviewCaller {
	const caller = tokens.get(token);
	if (caller === undefined) throw new Error("the table forgot a token it minted");
	return caller;
}

describe("the token table", () => {
	test("mints one token per role, and each names its own caller", () => {
		const tokens = createTokens();
		const owner = tokens.mint("owner");
		const reviewer = tokens.mint("reviewer");
		// Two roles may never share one token: a reviewer token would otherwise displace the
		// owner's and hand a reviewer the approval route.
		expect(owner).not.toBe(reviewer);
		expect(tokens.get(owner)).toEqual({ role: "owner" });
		expect(tokens.get(reviewer)).toEqual({ role: "reviewer" });
	});

	test("answers no caller for a token it did not mint", () => {
		const tokens = createTokens();
		const owner = tokens.mint("owner");
		const reviewer = tokens.mint("reviewer");
		// One character off, and the same length as the real thing: the comparison is the
		// value's, so a guess resolves to nobody rather than to the nearest entry.
		const wrong = `${owner[0] === "a" ? "b" : "a"}${owner.slice(1)}`;
		expect(wrong).toHaveLength(owner.length);
		expect(tokens.get(wrong)).toBeUndefined();
		expect(tokens.get(owner.slice(1))).toBeUndefined();
		expect(tokens.get("")).toBeUndefined();
		// A refusal is one token's answer: the table has not gone dark for the real links.
		expect(tokens.get(owner)).toEqual({ role: "owner" });
		expect(tokens.get(reviewer)).toEqual({ role: "reviewer" });
	});

	test("stops answering a revoked token, and keeps the one beside it", () => {
		const tokens = createTokens();
		const owner = tokens.mint("owner");
		const reviewer = tokens.mint("reviewer");
		tokens.revoke(reviewer);
		expect(tokens.get(reviewer)).toBeUndefined();
		expect(tokens.get(owner)).toEqual({ role: "owner" });
	});

	test("releases the name a revoked link bound, and shows the names still held", () => {
		const tokens = createTokens();
		const first = tokens.mint("reviewer");
		const second = tokens.mint("reviewer");
		// A name is bound by naming the caller the link holds: `web.ts` assigns to the object
		// `get` returned, which is why the table reads it back off that same entry.
		callerOf(tokens, first).name = "alice";
		expect(tokens.namesExcept(callerOf(tokens, second))).toEqual(["alice"]);
		// A caller's own name is not one of the names it must avoid, and a link that has not
		// written yet holds none.
		expect(tokens.namesExcept(callerOf(tokens, first))).toEqual([]);
		// A revoked token is forgotten rather than tombstoned, so a re-shared link may claim
		// the name the released one had.
		tokens.revoke(first);
		expect(tokens.namesExcept(callerOf(tokens, second))).toEqual([]);
	});

	test("retries past a colliding generator, and never lets two roles share a token", () => {
		const answers = ["dup", "dup", "fresh"];
		const tokens = createTokens(() => answers.shift() ?? "fresh");
		expect(tokens.mint("owner")).toBe("dup");
		// The generator answered the taken token once more, and the table asked again.
		expect(tokens.mint("reviewer")).toBe("fresh");
		expect(tokens.get("dup")).toEqual({ role: "owner" });
		expect(tokens.get("fresh")).toEqual({ role: "reviewer" });

		// A generator that never stops repeating cannot leave two roles on one token either:
		// the table suffixes what it was given rather than handing out a taken token.
		const stuck = createTokens(() => "same");
		expect(stuck.mint("owner")).toBe("same");
		expect(stuck.mint("reviewer")).not.toBe("same");
		expect(stuck.get("same")).toEqual({ role: "owner" });
	});
});
