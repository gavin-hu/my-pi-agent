import { describe, expect, test } from "bun:test";
import { PLAN_MODE_ENTRY_TYPE, isPlanModeEnabled } from "./plan-state.ts";

/** One persisted plan-mode state entry. */
function state(enabled: unknown): unknown {
	return { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled } };
}

describe("isPlanModeEnabled", () => {
	test("pins the persisted entry type", () => {
		expect(PLAN_MODE_ENTRY_TYPE).toBe("plan-mode");
	});

	test("is off for an empty or unrelated branch", () => {
		expect(isPlanModeEnabled([])).toBe(false);
		expect(
			isPlanModeEnabled([
				{ type: "message", id: "e1" },
				{ type: "custom", customType: "goal", data: { enabled: true } },
			]),
		).toBe(false);
	});

	test("follows the last valid entry on the branch", () => {
		expect(isPlanModeEnabled([state(true)])).toBe(true);
		expect(isPlanModeEnabled([state(true), state(false)])).toBe(false);
		expect(isPlanModeEnabled([state(false), state(true)])).toBe(true);
	});

	test("skips malformed entries instead of reading them as off", () => {
		expect(isPlanModeEnabled([state(true), state("yes")])).toBe(true);
		expect(isPlanModeEnabled([state(true), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: null }])).toBe(
			true,
		);
		expect(isPlanModeEnabled([state(true), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: {} }])).toBe(true);
		expect(isPlanModeEnabled([state(true), null, "nonsense"])).toBe(true);
	});
});
