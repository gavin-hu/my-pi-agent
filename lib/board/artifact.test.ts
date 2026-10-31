/**
 * The board's half of the plan store: a path is a plan only if it is this repository's
 * plan store and the file is there. Nothing here reads a plan.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { shortenPath } from "../format.ts";
import type { Card } from "./card.ts";
import { contractRoute, planForContract, planForExecute } from "./artifact.ts";

const ROOT = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-board-artifact-")));
const STORE = join(ROOT, "plans", "abc123");
const OUTSIDE = join(ROOT, "elsewhere");
mkdirSync(STORE, { recursive: true });
mkdirSync(OUTSIDE, { recursive: true });
afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
});

const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

/** A written plan in the store. */
function plan(name = "2026-10-29-1005-board-flow.md"): string {
	const path = join(STORE, name);
	writeFileSync(path, "# Board flow\n");
	return path;
}

/** A card as the gate reads it: an id, a lane, and the plan path it recorded. */
function card(lane: Card["lane"], planPath: string | undefined, id = "92"): Pick<Card, "id" | "lane" | "planPath"> {
	return { id, lane, planPath };
}

describe("planForContract", () => {
	test("accepts the markdown a store holds, at its absolute path", () => {
		const path = plan();
		expect(planForContract(STORE, path)).toEqual({ path });
	});

	test("accepts a bare name, which resolves inside the store", () => {
		const path = plan();
		expect(planForContract(STORE, "2026-10-29-1005-board-flow.md")).toEqual({ path });
	});

	test("refuses a path outside the store, naming the store", () => {
		const outside = join(OUTSIDE, "one.md");
		writeFileSync(outside, "# elsewhere\n");
		expect(planForContract(STORE, outside)).toEqual({
			error: `${shortenPath(outside)} is not in this repository's plan store; \`plan\` action \`write\` saves into ${shortenPath(STORE)}.`,
		});
	});

	test("refuses a file the store holds but the name rule does not", () => {
		// Not "outside the store": the reader's next step is a different name, not another place.
		const notes = join(STORE, "notes.txt");
		writeFileSync(notes, "notes\n");
		expect(planForContract(STORE, notes)).toEqual({
			error: `${shortenPath(notes)} is not a markdown plan; \`plan\` action \`write\` saves into ${shortenPath(STORE)}.`,
		});
	});

	test("expands the `~/…` form, and refuses it when it is not in the store", () => {
		// The form `plan` action `write` displays; a home path is outside a store under a temp dir.
		const checked = planForContract(STORE, "~/nowhere/one.md");
		expect("error" in checked && checked.error).toContain("is not in this repository's plan store");
		expect("error" in checked && checked.error).toContain(shortenPath(STORE));
	});

	test("refuses a plan that was never written", () => {
		const future = join(STORE, "future.md");
		expect(planForContract(STORE, future)).toEqual({
			error: `${shortenPath(future)} does not exist; \`plan\` action \`write\` saves the plan, and \`contract\` records the path it returns.`,
		});
	});

	test("refuses a directory named like a plan", () => {
		const path = join(STORE, "dir.md");
		mkdirSync(path, { recursive: true });
		expect(planForContract(STORE, path)).toEqual({
			error: `${shortenPath(path)} is not a file; record the markdown file \`plan\` action \`write\` saves.`,
		});
	});

	test("refuses a dotfile", () => {
		const path = join(STORE, ".hidden.md");
		writeFileSync(path, "# hidden\n");
		expect(planForContract(STORE, path)).toEqual({
			error: `${shortenPath(path)} is not a markdown plan; \`plan\` action \`write\` saves into ${shortenPath(STORE)}.`,
		});
	});

	test("keeps a path to one line, so a refusal cannot forge one", () => {
		const checked = planForContract(STORE, `${join(STORE, "a.md")}\n# done`);
		expect("error" in checked && checked.error.includes("\n")).toBe(false);
	});

	symlinkTest("refuses a link to a plan outside the store", () => {
		const outside = join(OUTSIDE, "linked.md");
		writeFileSync(outside, "# elsewhere\n");
		symlinkSync(outside, join(STORE, "link.md"));
		const checked = planForContract(STORE, join(STORE, "link.md"));
		expect("error" in checked && checked.error).toContain("is not in this repository's plan store");
	});
});

describe("planForExecute", () => {
	test("accepts the plan the card recorded, and binds the fact to that record", () => {
		const path = plan("recorded.md");
		expect(planForExecute(STORE, card("execute", path))).toEqual({ path, recorded: path });
	});

	test("admits a plan refined after it was recorded, because the check is presence, not bytes", () => {
		// The sign covers the three lines and the path, and `plan` action `steps` rewrites the
		// file after approval: an edit must not close the gate the approval opened.
		const path = plan("refined.md");
		expect(planForExecute(STORE, card("execute", path))).toEqual({ path, recorded: path });
		writeFileSync(path, "# Refined\n\n- [x] one\n");
		expect(planForExecute(STORE, card("execute", path))).toEqual({ path, recorded: path });
	});

	test("refuses a plan deleted while the card is still in plan, where contract works", () => {
		const path = join(STORE, "deleted.md");
		expect(planForExecute(STORE, card("plan", path))).toEqual({
			error: `the plan recorded for #92 is gone (${shortenPath(path)}); record it with \`contract\`.`,
		});
	});

	test("names the route back through plan when the card is already executing", () => {
		// `contract` is written in plan and nowhere else, so the way out has to say so.
		const path = join(STORE, "deleted.md");
		expect(planForExecute(STORE, card("execute", path))).toEqual({
			error: `the plan recorded for #92 is gone (${shortenPath(path)}); move it back to plan, then record it with \`contract\`.`,
		});
	});

	test("refuses a legacy path outside the store, with the same route", () => {
		const outside = join(OUTSIDE, "legacy.md");
		writeFileSync(outside, "# legacy\n");
		const checked = planForExecute(STORE, card("blocked", outside));
		expect("error" in checked && checked.error).toContain("outside this repository's plan store");
		expect("error" in checked && checked.error).toContain("move it back to plan");
	});
});

describe("contractRoute", () => {
	test("names a route that is legal in the lane the card is in", () => {
		expect(contractRoute({ lane: "plan" })).toBe("record it with `contract`.");
		// `contract` is written in plan, so a card elsewhere has to get back there first.
		expect(contractRoute({ lane: "execute" })).toBe("move it back to plan, then record it with `contract`.");
		expect(contractRoute({ lane: "blocked" })).toBe("move it back to plan, then record it with `contract`.");
		// From the pool the missing step is the claim, not the move.
		expect(contractRoute({ lane: "backlog" })).toBe("claim it, then record it with `contract`.");
		expect(contractRoute({ lane: "done" })).toBe("a finished card's plan cannot change.");
	});
});
