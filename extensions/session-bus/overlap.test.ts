/**
 * Claim overlap: the bus's one "do these paths collide?" predicate.
 */

import { describe, expect, test } from "bun:test";
import { claimsConflict } from "./overlap.ts";

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
		// A path is data: `./x/`, `x//y`, and a Windows spelling name the same file.
		expect(claimsConflict("./src/api/", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("src\\api", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("src//api", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("  src/api  ", "src/api/route.ts")).toBe(true);
		expect(claimsConflict("./src/api/", "src/apiv2")).toBe(false);
	});

	test("a plain file claim covers itself and nothing beside it", () => {
		expect(claimsConflict("a.md", "a.md")).toBe(true);
		expect(claimsConflict("a.md", "b.md")).toBe(false);
	});

	test("the root claim covers everything, however the root is spelled", () => {
		expect(claimsConflict("", "src/api")).toBe(true);
		expect(claimsConflict(".", "src/api")).toBe(true);
		expect(claimsConflict("./", "src/api")).toBe(true);
	});
});
