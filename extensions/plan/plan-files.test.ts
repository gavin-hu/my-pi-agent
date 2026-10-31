/**
 * How a plan reaches the disk: the name a new one claims, and the turn a plan's edits take.
 *
 * Two races live here. Across processes, two sessions writing one title in the same minute
 * used to land on one file, because the name was probed and then renamed over; inside one
 * process, a save and a `steps` tick could each write back the copy the other had already
 * replaced. Both are proved against the shipped functions rather than described.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchDir, useEnv } from "../../test/helpers/env.ts";
import { fixedPlanDate, planRepoPi } from "../../test/helpers/fixtures/plan.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createAtomic } from "./plan-files.ts";
import { createPlanStore } from "./plans.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One agent directory for this file, so no test writes into the developer's own. */
const AGENT = realpathSync.native(mkdtempSync(join(tmpdir(), "pi-plan-files-agent-")));
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

/** A store in a fresh repository rooted at `root`, with a frozen clock. */
function repoStore(root: string) {
	return createPlanStore(planRepoPi(root), { now: () => fixedPlanDate() });
}

describe("a new plan's name", () => {
	test("is claimed, not probed: an existing plan is never replaced", () => {
		const dir = realpathSync.native(scratchDir(temps, "pi-plan-files-"));
		const base = "2026-10-08-1530-fix-the-limiter";
		writeFileSync(join(dir, `${base}.md`), "somebody else's plan\n");

		const path = createAtomic(dir, base, "mine\n");

		expect(path).toBe(join(dir, `${base}-2.md`));
		expect(readFileSync(join(dir, `${base}.md`), "utf-8")).toBe("somebody else's plan\n");
		expect(readFileSync(path, "utf-8")).toBe("mine\n");
	});

	test("survives a rival claiming the name in the window between the write and the link", () => {
		const dir = realpathSync.native(scratchDir(temps, "pi-plan-files-"));
		const base = "2026-10-08-1530-fix-the-limiter";
		// Exactly the cross-process race: the other session gets there first, after this one
		// has already decided which name is free. A probe-then-rename replaced that plan.
		const path = createAtomic(dir, base, "mine\n", {
			beforeLink: () => writeFileSync(join(dir, `${base}.md`), "theirs\n"),
		});

		expect(path).toBe(join(dir, `${base}-2.md`));
		expect(readFileSync(join(dir, `${base}.md`), "utf-8")).toBe("theirs\n");
		expect(readFileSync(path, "utf-8")).toBe("mine\n");
	});

	test("leaves no temp file behind, on the way out or on a failure", () => {
		const dir = realpathSync.native(scratchDir(temps, "pi-plan-files-"));
		const base = "2026-10-08-1530-one";
		createAtomic(dir, base, "one\n");
		expect(readdirSync(dir)).toEqual([`${base}.md`]);

		// A directory that does not exist is not EEXIST: the failure is the caller's to see.
		expect(() => createAtomic(join(dir, "missing"), base, "two\n")).toThrow();
		expect(readdirSync(dir)).toEqual([`${base}.md`]);
	});

	test("is what a store's own create uses, so one minute's tie is two plans", async () => {
		const root = realpathSync.native(scratchDir(temps, "pi-plan-store-"));
		const store = repoStore(root);

		const first = await store.write(root, { title: "Fix the limiter", content: "first\n" });
		const second = await store.write(root, { title: "Fix the limiter", content: "second\n" });

		expect(first.path).not.toBe(second.path);
		expect(readFileSync(first.path, "utf-8")).toBe("first\n");
		expect(readFileSync(second.path, "utf-8")).toBe("second\n");
	});
});

describe("a plan's edits take turns", () => {
	test("a tick and a comment save fired together both land", async () => {
		const root = realpathSync.native(scratchDir(temps, "pi-plan-store-"));
		const store = repoStore(root);
		const plan = await store.write(root, {
			title: "Two writers",
			content: "## Steps\n- [ ] One\n- [ ] Two\n\n## Notes\nGreen.\n",
		});

		await Promise.all([
			store.setSteps(root, plan.path, [{ step: 1, status: "completed", expected: "One" }]),
			store.saveFeedback(root, plan.path, [{ anchor: 0, comment: "Looks right" }]),
		]);

		const after = readFileSync(plan.path, "utf-8");
		// Each write rebuilt the file from its own read; without the queue one of them wrote a
		// copy that predated the other and the later write discarded it.
		expect(after).toContain("- [x] One");
		expect(after).toContain("Looks right");
	});

	test("two plans do not wait on each other", async () => {
		const root = realpathSync.native(scratchDir(temps, "pi-plan-store-"));
		const store = repoStore(root);
		const first = await store.write(root, { title: "First", content: "## Steps\n- [ ] One\n" });
		const second = await store.write(root, { title: "Second", content: "## Steps\n- [ ] One\n" });

		const [a, b] = await Promise.all([
			store.setSteps(root, first.path, [{ step: 1, status: "completed", expected: "One" }]),
			store.setSteps(root, second.path, [{ step: 1, status: "completed", expected: "One" }]),
		]);

		expect(a.content).toContain("- [x] One");
		expect(b.content).toContain("- [x] One");
		expect(readFileSync(first.path, "utf-8")).toContain("- [x] One");
		expect(readFileSync(second.path, "utf-8")).toContain("- [x] One");
	});
});
