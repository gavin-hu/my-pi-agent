/**
 * The store's write paths: naming a plan, refining one, and the size limit both keep.
 *
 * A plan is the artifact a review annotates and an approval executes, so the two things a
 * write can get wrong are where the file lands and how large it is allowed to grow. The
 * cap moved here with these cases when they outgrew `plans.test.ts`; the save path's half
 * is here too, because a page can write more comments than a plan may carry, and a file
 * past the limit is one `write` then refuses to refine.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pageRevision } from "./plan-text.ts";
import { createPlanStore, MAX_PLAN_BYTES, PlanMovedError, PlanTooLargeError } from "./plans.ts";
import { saveOwnerAnnotations } from "./web-write.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { shortenPath } from "../../lib/format.ts";
import { tempDir, useEnv } from "../../test/helpers/env.ts";
import { fixedPlanDate, planRepoPi } from "../../test/helpers/fixtures/plan.ts";

const FIXED = fixedPlanDate();
/** One agent directory for this file: plans live outside the project, so a test must not write the real one. */
const AGENT = tempDir("pi-plan-write-agent-");
let scoped: { restore: () => void } | undefined;
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

describe("plan store — write", () => {
	test("names the file by timestamp and slug in the keyed store", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Add rate limiting", content: "# Plan\n1. Do it" });

		expect(file.path).toBe(join(AGENT, "plans", repoKeyOf(join(root, ".git")), "2026-10-08-1530-add-rate-limiting.md"));
		expect(readFileSync(file.path, "utf-8")).toContain("1. Do it");
		expect(file.relativePath).toBe(shortenPath(file.path));
		expect(file.bytes).toBeGreaterThan(0);
	});

	test("writes nothing into the checkout, not even an ignore file", async () => {
		const root = tempDir("pi-plan-write-");
		await createPlanStore(planRepoPi(root), { now: () => FIXED }).write(root, { title: "Kept", content: "body" });

		expect(readdirSync(root)).toEqual([]);
	});

	test("suffixes a colliding name instead of overwriting", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const first = await store.write(root, { title: "Same", content: "one" });
		const second = await store.write(root, { title: "Same", content: "two" });
		expect(second.path).not.toBe(first.path);
		expect(second.path).toContain("-same-2.md");
		expect(readFileSync(first.path, "utf-8")).toBe("one");
	});

	test("overwrites an existing in-directory plan when plan_path is given", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const first = await store.write(root, { title: "First", content: "one" });
		const refined = await store.write(root, { title: "First", content: "two", planPath: first.path });
		expect(refined.path).toBe(first.path);
		expect(readFileSync(first.path, "utf-8")).toBe("two");
	});

	test("rejects a plan_path outside the plans directory", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		await expect(store.write(root, { title: "x", content: "x", planPath: join(root, "escape.md") })).rejects.toThrow(
			/inside the plans directory/,
		);
	});

	test("rejects an oversized plan and an empty title", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		await expect(store.write(root, { title: "big", content: "x".repeat(MAX_PLAN_BYTES + 1) })).rejects.toThrow(
			/too large/,
		);
		await expect(store.write(root, { title: "   ", content: "x" })).rejects.toThrow(/title is required/);
	});
});

describe("a save that would outgrow its limit", () => {
	/** Comments a page can hold: the caps the server enforces, at their length. */
	const flood = Array.from({ length: 200 }, (_, index) => ({ anchor: 1, comment: `note ${index} `.padEnd(2000, "x") }));

	test("is refused before it writes, and the plan is left as it was", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Tight", content: "# Plan\n\nBody.\n" });

		const failure = store.saveFeedback(root, file.path, flood);

		await expect(failure).rejects.toBeInstanceOf(PlanTooLargeError);
		expect(readFileSync(file.path, "utf-8")).toBe("# Plan\n\nBody.\n");
	});

	test("reaches the page as 413 with the store's own sentence", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Tight", content: "# Plan\n\nBody.\n" });
		const rev = pageRevision(file.content);

		const saved = await saveOwnerAnnotations({ store, cwd: root, path: file.path, rev }, flood);

		expect(saved).toEqual({
			ok: false,
			status: 413,
			message: expect.stringContaining(`the limit is ${MAX_PLAN_BYTES}`),
		});
	});
});

describe("a save anchored to a revision", () => {
	test("is refused against another revision, and written against its own", async () => {
		const root = tempDir("pi-plan-write-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Anchored", content: "# Plan\n\nBody.\n" });

		await expect(
			store.saveFeedback(root, file.path, [{ anchor: 2, comment: "wrong" }], { expect: "0123456789ab" }),
		).rejects.toBeInstanceOf(PlanMovedError);
		expect(readFileSync(file.path, "utf-8")).toBe("# Plan\n\nBody.\n");

		// The revision the page would have posted: the text it rendered.
		const saved = await store.saveFeedback(root, file.path, [{ anchor: 2, comment: "right" }], {
			expect: pageRevision(file.content),
		});
		expect(saved.content).toContain("> [!REVIEW] right");
	});
});
