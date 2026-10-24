/**
 * The shared-file rule at claiming time: which unit a session holds, and the
 * claim it may therefore not make.
 *
 * Both halves are pure, so the cases here are the whole contract: a claim table
 * in, held units out; held units and paths in, the refusal out. The runtime suite
 * proves the wiring (`extensions/session-bus/runtime.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import type { PlanUnit } from "../../lib/plans/team.ts";
import { heldUnits, sharedClaimRefusal } from "./membership.ts";

/** The split the runtime suite joins: a lead unit and one owner. */
const UNITS: PlanUnit[] = [
	{ name: "contract", paths: ["src/contract"], test: "bun test src/contract", dependsOn: [], lead: true },
	{ name: "core", paths: ["src/core"], test: "bun test src/core", dependsOn: ["contract"] },
];

/** A claim table with one session on each unit. */
const CLAIMS = [
	{ path: "src/contract", owner: "lead-session" },
	{ path: "src/core", owner: "owner-session" },
];

const owner = heldUnits(UNITS, CLAIMS, "owner-session");
const lead = heldUnits(UNITS, CLAIMS, "lead-session");

describe("held units", () => {
	test("holds the unit whose paths the session's claims cover", () => {
		expect(owner).toEqual([{ unit: "core", lead: "contract", owner: true }]);
		expect(lead).toEqual([{ unit: "contract", lead: "contract", owner: false }]);
	});

	test("holds nothing for a session with no claim over a unit", () => {
		expect(heldUnits(UNITS, CLAIMS, "stranger")).toEqual([]);
		expect(heldUnits(UNITS, [], "owner-session")).toEqual([]);
	});

	test("holds nothing when the plan carries no lead, because the rule needs one", () => {
		const noLead = UNITS.map((unit) => ({ ...unit, lead: undefined }));
		expect(heldUnits(noLead, CLAIMS, "owner-session")).toEqual([]);
	});

	test("a claim inside a unit's directory path still holds it", () => {
		const nested = heldUnits(UNITS, [{ path: "src/core/routes.ts", owner: "me" }], "me");
		expect(nested.map((entry) => entry.unit)).toEqual(["core"]);
	});
});

describe("the shared-file refusal", () => {
	test("names the file and the lead for an owner's claim", () => {
		expect(sharedClaimRefusal(owner, ["package.json"])).toBe(
			'package.json is a shared file; only the lead "contract" may claim it.',
		);
	});

	test("refuses a shared file a directory claim would cover, and names the file", () => {
		// A claim on the root covers everything, so the refusal names what it hit
		// rather than the path the caller typed.
		expect(sharedClaimRefusal(owner, ["."])).toBe(
			'package.json is a shared file; only the lead "contract" may claim it.',
		);
	});

	test("lets the lead claim a shared file", () => {
		expect(sharedClaimRefusal(lead, ["package.json", "CHANGELOG.md"])).toBeUndefined();
	});

	test("lets anyone claim a path that is not shared", () => {
		expect(sharedClaimRefusal(owner, ["src/core/routes.ts", "docs/extensions/plan.md"])).toBeUndefined();
	});

	test("applies the canonical list only, never a project's own", () => {
		// `docs/` is approval-only by design: the bus reads no configuration, so a
		// project-extended list cannot start refusing claims behind the user's back.
		expect(sharedClaimRefusal(owner, ["docs"])).toBeUndefined();
	});

	test("refuses nothing when no owner unit is held", () => {
		expect(sharedClaimRefusal([], ["package.json"])).toBeUndefined();
		expect(sharedClaimRefusal(lead, ["package.json"])).toBeUndefined();
	});
});
