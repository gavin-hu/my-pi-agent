/**
 * The page token: entropy, shape, and the comparison a served route trusts.
 *
 * A page a browser can open is a page any local process can call, so the token is
 * the whole credential. The cases here pin the two properties a route depends on:
 * every mint is distinct and 128 bits wide, and a guess — wrong value, wrong
 * length, or absent — never matches.
 */

import { describe, expect, test } from "bun:test";
import { mintToken, TOKEN_BYTES, tokenMatches } from "./token.ts";

describe("mintToken", () => {
	test("is hex and 128 bits wide", () => {
		const token = mintToken();
		expect(token).toMatch(/^[0-9a-f]+$/);
		expect(token).toHaveLength(TOKEN_BYTES * 2);
	});

	test("never repeats", () => {
		const tokens = new Set(Array.from({ length: 200 }, () => mintToken()));
		expect(tokens.size).toBe(200);
	});
});

describe("tokenMatches", () => {
	test("accepts the token it was given", () => {
		const token = mintToken();
		expect(tokenMatches(token, token)).toBe(true);
	});

	test("refuses another token", () => {
		expect(tokenMatches(mintToken(), mintToken())).toBe(false);
	});

	test("refuses a guess of the right length", () => {
		expect(tokenMatches("a".repeat(TOKEN_BYTES * 2), "b".repeat(TOKEN_BYTES * 2))).toBe(false);
	});

	test("refuses a guess of a different length, and never throws on one", () => {
		const token = mintToken();
		expect(tokenMatches(token, "")).toBe(false);
		expect(tokenMatches(token, token.slice(1))).toBe(false);
		expect(tokenMatches(token, `${token}0`)).toBe(false);
	});

	test("an unminted server accepts nothing", () => {
		// A failed mint must not turn the empty query string into a credential.
		expect(tokenMatches("", "")).toBe(false);
		expect(tokenMatches("", "anything")).toBe(false);
	});
});
