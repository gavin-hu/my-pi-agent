/**
 * Claim overlap: one predicate for the bus's claims and a plan's units.
 */

import { describe, expect, test } from "bun:test";
import { claimsConflict, findClaimOverlap, normalizeClaimPath } from "./overlap.ts";

describe("normalizeClaimPath", () => {
	test("keeps a repository-relative posix path as written", () => {
		expect(normalizeClaimPath("src/api")).toBe("src/api");
		expect(normalizeClaimPath("a.md")).toBe("a.md");
	});

	test("strips a leading ./, a trailing slash, and doubled slashes", () => {
		expect(normalizeClaimPath("./src/api/")).toBe("src/api");
		expect(normalizeClaimPath("src//api")).toBe("src/api");
	});

	test("reads a Windows spelling as the same path", () => {
		expect(normalizeClaimPath("src\\api\\route.ts")).toBe("src/api/route.ts");
	});

	test("trims padding and treats the root as empty", () => {
		expect(normalizeClaimPath("  src/api  ")).toBe("src/api");
		expect(normalizeClaimPath(".")).toBe("");
		expect(normalizeClaimPath("./")).toBe("");
	});
});

describe("claimsConflict", () => {
	test("a claim covers itself", () => {
		expect(claimsConflict("src/api", "src/api")).toBe(true);
	});

	test("a claim covers everything below it, in either direction", () => {
		expect(claimsConflict("src/api", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("src/api/route.ts", "src/api")).toBe(true);
	});

	test("does not treat a shared name prefix as containment", () => {
		expect(claimsConflict("src/api", "src/apiv2")).toBe(false);
		expect(claimsConflict("src/api", "src/api-client")).toBe(false);
	});

	test("sibling directories do not collide", () => {
		expect(claimsConflict("src/billing/core", "src/billing/report")).toBe(false);
	});

	test("compares the normalized spelling, not the raw one", () => {
		expect(claimsConflict("./src/api/", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("src\\api", "src/api/route.ts")).toBe(true);
	});

	test("the root claim covers everything", () => {
		expect(claimsConflict("", "src/api")).toBe(true);
	});
});

describe("findClaimOverlap", () => {
	test("returns the first colliding pair", () => {
		expect(findClaimOverlap(["src/a", "src/b", "src/a/deep"])).toEqual(["src/a", "src/a/deep"]);
	});

	test("returns nothing for disjoint prefixes", () => {
		expect(findClaimOverlap(["src/a", "src/b", "test/c"])).toBeUndefined();
	});

	test("catches a duplicate claim", () => {
		expect(findClaimOverlap(["src/a", "src/a"])).toEqual(["src/a", "src/a"]);
	});
});
