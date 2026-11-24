/**
 * The session's mode as the branch carries it: the one flag plan writes, the one
 * lead mode will write, and the switch between them.
 *
 * The mode is replayed from untrusted branch entries, so the cases are about which
 * write counts, what a malformed entry does (nothing, rather than wiping a valid
 * value), and the one transition a mode refuses.
 */

import { describe, expect, test } from "bun:test";
import {
	LEAD_MODE_ENTRY_TYPE,
	PLAN_MODE_ENTRY_TYPE,
	isPlanModeEnabled,
	lastModeState,
	mayEnter,
	mayEnterFrom,
	modeOf,
} from "./mode-state.ts";

// --- The plan-mode flag -----------------------------------------------------

describe("isPlanModeEnabled", () => {
	/** One persisted plan-mode state entry. */
	function state(enabled: unknown): unknown {
		return { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled } };
	}

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

// --- The session mode -------------------------------------------------------

describe("lastModeState", () => {
	/** One persisted mode entry of either type. */
	function entry(entryType: string, enabled: unknown, removed?: unknown): unknown {
		return { type: "custom", customType: entryType, data: removed === undefined ? { enabled } : { enabled, removed } };
	}
	const plan = (enabled: unknown, removed?: unknown): unknown => entry(PLAN_MODE_ENTRY_TYPE, enabled, removed);
	const lead = (enabled: unknown, removed?: unknown): unknown => entry(LEAD_MODE_ENTRY_TYPE, enabled, removed);

	test("is auto for an empty or unrelated branch", () => {
		expect(modeOf([])).toBe("auto");
		expect(lastModeState([{ type: "custom", customType: "goal", data: { enabled: true } }])).toEqual({ mode: "auto" });
	});

	test("reads a lead entry, which nothing writes yet", () => {
		expect(modeOf([lead(true)])).toBe("lead");
		expect(lastModeState([lead(true, ["edit", "write"])])).toEqual({ mode: "lead", removed: ["edit", "write"] });
	});

	test("does not read a lead entry as planning", () => {
		expect(isPlanModeEnabled([lead(true)])).toBe(false);
	});

	test("gives plan a branch that carries both", () => {
		expect(modeOf([lead(true), plan(true)])).toBe("plan");
		expect(modeOf([plan(false), lead(true)])).toBe("lead");
		expect(lastModeState([lead(true, ["edit"]), plan(true, ["write"])])).toEqual({ mode: "plan", removed: ["write"] });
	});

	test("skips a malformed entry instead of reading it as off", () => {
		expect(modeOf([lead(true), lead("yes")])).toBe("lead");
		expect(modeOf([lead(true), { type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: null }])).toBe("lead");
	});

	test("keeps only the tool names a mode can put back", () => {
		expect(lastModeState([lead(true, ["edit", 3, null])])).toEqual({ mode: "lead", removed: ["edit"] });
	});
});

describe("mayEnter", () => {
	test("allows every switch but a lead entering plan", () => {
		expect(mayEnter("plan", "auto")).toBeUndefined();
		expect(mayEnter("lead", "auto")).toBeUndefined();
		expect(mayEnter("lead", "plan")).toBeUndefined();
		expect(mayEnter("auto", "lead")).toBeUndefined();
	});

	test("allows a door re-entered in the mode already in force", () => {
		expect(mayEnter("lead", "lead")).toBeUndefined();
		expect(mayEnter("auto", "auto")).toBeUndefined();
	});

	test("refuses plan from a lead, and names the hatch", () => {
		expect(mayEnter("plan", "lead")).toContain("/board stop");
	});

	test("refuses a mode it does not know", () => {
		expect(mayEnter("surf", "auto")).toContain("is not a mode");
	});
});

describe("mayEnterFrom", () => {
	const planEntry = (): unknown => ({ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } });
	const leadEntry = (): unknown => ({ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } });

	test("reads the mode the branch carries", () => {
		expect(mayEnterFrom("plan", [])).toBeUndefined();
		expect(mayEnterFrom("plan", [planEntry()])).toBeUndefined();
		expect(mayEnterFrom("lead", [leadEntry()])).toBeUndefined();
		expect(mayEnterFrom("lead", [planEntry()])).toBeUndefined();
	});

	test("refuses plan on a lead branch, naming the hatch a reader can type", () => {
		expect(mayEnterFrom("plan", [leadEntry()])).toContain("/board stop");
	});

	test("refuses plan on a lead branch whose lead entry was later withdrawn", () => {
		// The last valid lead entry wins, so a disable opens the door again: the refusal is about
		// the seat being held now, not about the branch having ever held it.
		const withdrawn = { type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: false } };
		expect(mayEnterFrom("plan", [leadEntry(), withdrawn])).toBeUndefined();
	});

	test("allows plan on a branch carrying both, which the replay already calls plan", () => {
		// The defect's own state, and why the gate is not the repair: plan wins the replay, so
		// there is no switch left to refuse. Reconciling such a branch is #852's card.
		expect(modeOf([leadEntry(), planEntry()])).toBe("plan");
		expect(mayEnterFrom("plan", [leadEntry(), planEntry()])).toBeUndefined();
	});
});
