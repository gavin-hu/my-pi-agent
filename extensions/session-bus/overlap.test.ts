/**
 * Claim overlap: the bus's one "do these paths collide?" predicate.
 */

import { describe, expect, test } from "bun:test";
import { claimsConflict, normalizeClaimPath } from "./overlap.ts";

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
