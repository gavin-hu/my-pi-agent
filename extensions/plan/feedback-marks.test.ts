/**
 * The review-marker codec: who a marker belongs to, and where it lands.
 *
 * A plan file is written by more than one writer — the owner in the browser and every
 * reviewer holding a link — and one writer's save replaces that writer's markers only. So
 * the two things this suite holds are the two ways that promise breaks: a body that reads
 * back as another writer's, and a marker placed where the reader cannot see it.
 *
 * It owns `saveFeedback`'s author scoping (which it took from `plans.test.ts` when it
 * outgrew that suite), the escape that keeps an owner's `@name:` note the owner's, and the
 * placement rule for a fence that never closes.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planBlocks } from "./blocks.ts";
import { carryFeedback, formatFeedback, parseFeedback, stripFeedback } from "./feedback.ts";
import { createPlanStore } from "./plans.ts";
import { tempDir, useEnv } from "../../test/helpers/env.ts";
import { fixedPlanDate, planRepoPi } from "../../test/helpers/fixtures/plan.ts";

const FIXED = fixedPlanDate();
/** One agent directory for this file: plans live outside the project, so a test must not write the real one. */
const AGENT = tempDir("pi-plan-authors-agent-");
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

describe("plan store — authored review comments", () => {
	/** A repo store with one plan holding two steps. */
	async function seeded(): Promise<{ root: string; store: ReturnType<typeof createPlanStore>; path: string }> {
		const root = tempDir("pi-plan-authors-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Review", content: "# Plan\n- [ ] one\n- [ ] two" });
		return { root, store, path: file.path };
	}

	test("a save writes one writer's comments and keeps the other writer's", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 2, comment: "bob's" }], { author: "bob" });
		expect(updated.content).toBe("# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n- [ ] two\n> [!REVIEW] @bob: bob's");
	});

	test("the owner's save keeps every reviewer's comment", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		await store.saveFeedback(root, path, [{ anchor: 2, comment: "bob's" }], { author: "bob" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 1, comment: "owner's" }]);
		expect(updated.content).toBe(
			"# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n> [!REVIEW] owner's\n- [ ] two\n> [!REVIEW] @bob: bob's",
		);
	});

	test("a save cannot re-sign another writer's comment", async () => {
		const { root, store, path } = await seeded();
		const updated = await store.saveFeedback(
			root,
			path,
			[
				{ anchor: 1, comment: "pretending", author: "alice" },
				{ anchor: 2, comment: "mine" },
			],
			{ author: "bob" },
		);
		expect(updated.content).toBe("# Plan\n- [ ] one\n- [ ] two\n> [!REVIEW] @bob: mine");
	});

	test("a reviewer's own save replaces their earlier comments", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "first" }], { author: "alice" });
		const updated = await store.saveFeedback(root, path, [{ anchor: 2, comment: "second" }], { author: "alice" });
		expect(updated.content).toBe("# Plan\n- [ ] one\n- [ ] two\n> [!REVIEW] @alice: second");
	});

	test("refuses a missing or outside plan", async () => {
		const { root, store } = await seeded();
		writeFileSync(join(root, "outside.md"), "- One");
		await expect(
			store.saveFeedback(root, join(root, ".pi", "plans", "nope.md"), [], { author: "alice" }),
		).rejects.toThrow(/No plan file/);
		await expect(store.saveFeedback(root, join(root, "outside.md"), [], { author: "alice" })).rejects.toThrow(
			/No plan file/,
		);
	});

	test("a refinement carries the review onto the rewritten plan", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "alice's" }], { author: "alice" });
		const rewritten = await store.write(root, {
			title: "Review",
			planPath: path,
			content: "# Plan\n- [ ] one\n- [ ] two\n- [ ] three",
		});
		expect(rewritten.content).toBe("# Plan\n- [ ] one\n> [!REVIEW] @alice: alice's\n- [ ] two\n- [ ] three");
		expect(readFileSync(path, "utf-8")).toBe(rewritten.content);
	});

	test("a refinement keeps a carried comment on a block the page renders", async () => {
		const { root, store, path } = await seeded();
		await store.saveFeedback(root, path, [{ anchor: 2, comment: "about two" }]);
		// The step the comment hung on is gone; the section it lived in is not.
		await store.write(root, { title: "Review", planPath: path, content: "# Plan\n- [ ] one\n\n## Notes\nGreen.\n" });

		const stored = readFileSync(path, "utf-8");
		// The step it hung on is gone, so the marker says the placement was a guess.
		expect(stored).toContain("- [ ] one\n> [!REVIEW moved] about two\n");
		const starts = planBlocks(stripFeedback(stored))
			.filter((block) => block.kind !== "blank")
			.map((block) => block.start);
		const annotations = parseFeedback(stored);
		expect(annotations.length).toBe(1);
		for (const annotation of annotations) expect(starts).toContain(annotation.anchor);
	});

	test("a new plan never inherits markers from the content it is given", async () => {
		const root = tempDir("pi-plan-authors-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Fresh", content: "- [ ] one\n> [!REVIEW] stray" });
		expect(file.content).toBe("- [ ] one");
	});
});

describe("an owner's note that looks like a name's", () => {
	/** A repo store with one plan holding two steps, and a store the codec can be read through. */
	async function onePlan(): Promise<{ root: string; store: ReturnType<typeof createPlanStore>; path: string }> {
		const root = tempDir("pi-plan-marks-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const file = await store.write(root, { title: "Looks", content: "# Plan\n- [ ] one\n- [ ] two" });
		return { root, store, path: file.path };
	}

	test("is stored escaped, and reads back as the owner's own", async () => {
		const { root, store, path } = await onePlan();
		const saved = await store.saveFeedback(root, path, [{ anchor: 2, comment: "@bob: should we split this?" }]);

		expect(saved.content).toContain("> [!REVIEW] \\@bob: should we split this?");
		expect(parseFeedback(saved.content)).toEqual([{ anchor: 2, comment: "@bob: should we split this?" }]);
	});

	test("survives the reviewer it names saving a note of their own", async () => {
		// The bug this fixes: bob's save replaces every marker that reads as bob's, so an
		// owner's note beginning `@bob:` was deleted by it.
		const { root, store, path } = await onePlan();
		await store.saveFeedback(root, path, [{ anchor: 1, comment: "@bob: should we split this?" }]);
		const after = await store.saveFeedback(root, path, [{ anchor: 2, comment: "bob's own" }], { author: "bob" });

		expect(after.content).toContain("should we split this?");
		expect(parseFeedback(after.content)).toEqual([
			{ anchor: 1, comment: "@bob: should we split this?" },
			{ anchor: 2, comment: "bob's own", author: "bob" },
		]);
	});

	test("a note that already begins with a backslash round-trips unchanged", async () => {
		const { root, store, path } = await onePlan();
		const saved = await store.saveFeedback(root, path, [{ anchor: 2, comment: "\\@bob: literally" }]);

		expect(saved.content).toContain("> [!REVIEW] \\\\@bob: literally");
		expect(parseFeedback(saved.content)).toEqual([{ anchor: 2, comment: "\\@bob: literally" }]);
	});
});

describe("where a marker lands", () => {
	test("a comment on a fence that never closes goes above it, not inside it", () => {
		// The bug this fixes: the marker was written after the block's last line, which an
		// unclosed fence runs to, so the note became code and no review ever read it back.
		const plan = "# Plan\n\n```\ncode line\n";
		const saved = formatFeedback(plan, [{ anchor: 2, comment: "note" }]);

		expect(saved.indexOf("[!REVIEW]")).toBeLessThan(saved.indexOf("```"));
		expect(parseFeedback(saved)).toEqual([{ anchor: 0, comment: "note" }]);
		expect(stripFeedback(saved)).not.toContain("[!REVIEW]");
	});

	test("a closed fence keeps its comment under it", () => {
		const plan = "# Plan\n\n```\nx\n```\n\nAfter.\n";
		const saved = formatFeedback(plan, [{ anchor: 2, comment: "note" }]);

		expect(saved.indexOf("```\nx")).toBeLessThan(saved.indexOf("[!REVIEW]"));
		expect(parseFeedback(saved)).toEqual([{ anchor: 2, comment: "note" }]);
	});

	test("a carried comment follows the same rule on a rewritten plan", () => {
		const withNote = formatFeedback("# Plan\n\n```\nx\n```\n\nAfter.\n", [{ anchor: 2, comment: "note" }]);
		// The refinement drops the fence's text and ends the plan with an unclosed one.
		const carried = carryFeedback(withNote, "# Plan\n\n```\nrewritten\n");

		expect(carried.indexOf("[!REVIEW]")).toBeLessThan(carried.indexOf("```"));
		expect(parseFeedback(carried).length).toBe(1);
	});
});
