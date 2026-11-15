/**
 * Claim overlap: the bus's one "do these paths collide?" predicate.
 */

import { describe, expect, test } from "bun:test";
import { claimsConflict, keepsOverlap } from "./overlap.ts";

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

describe("keepsOverlap", () => {
	test("the claim published earlier keeps", () => {
		expect(keepsOverlap({ mtimeMs: 10, owner: "s-b" }, { mtimeMs: 11, owner: "s-a" })).toBe(true);
		expect(keepsOverlap({ mtimeMs: 11, owner: "s-b" }, { mtimeMs: 10, owner: "s-a" })).toBe(false);
	});

	test("two claims in one tick fall to the smaller owner, whichever side asks", () => {
		// The tie-break is what makes the rule total: a filesystem's clock cannot separate two writes
		// inside one tick, and without it both claimants would keep, or both would back off.
		expect(keepsOverlap({ mtimeMs: 10, owner: "s-a" }, { mtimeMs: 10, owner: "s-b" })).toBe(true);
		expect(keepsOverlap({ mtimeMs: 10, owner: "s-b" }, { mtimeMs: 10, owner: "s-a" })).toBe(false);
	});

	test("is antisymmetric, which is why both claimants reach the same verdict", () => {
		// Whatever the facts, exactly one of the two asks keeps: the pair cannot both keep, and cannot
		// both give way. That is what lets both sides of a race decide it independently.
		const a = { mtimeMs: 10, owner: "s-a" };
		const b = { mtimeMs: 10, owner: "s-b" };
		expect(keepsOverlap(a, b)).toBe(!keepsOverlap(b, a));
		const earlier = { mtimeMs: 9, owner: "s-z" };
		expect(keepsOverlap(earlier, a)).toBe(!keepsOverlap(a, earlier));
		expect(keepsOverlap(earlier, { mtimeMs: 9, owner: "s-a" })).toBe(false);
		expect(keepsOverlap({ mtimeMs: 9, owner: "s-a" }, earlier)).toBe(true);
	});
});
