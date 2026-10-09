import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "./git.ts";
import { loadRegistry } from "./registry.ts";
import { WORKTREE_TOOLS } from "./tools.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { bootWorktree, testConfig } from "../../test/helpers/fixtures/worktree.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function worktreePath(repo: string, name: string): string {
	return canonicalize(join(repo, ".pi", "worktrees", name));
}

describe("enterWorktree", () => {
	test("enters a new worktree and records it in state and the registry", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);

		const result = await harness.run(WORKTREE_TOOLS.enter, { name: "a" });
		const dir = worktreePath(repo, "a");
		expect(result.content[0].text).toContain("Entered worktree");
		expect(harness.ctx.statuses.get("worktree")).toContain("a");
		expect(
			harness.pi.entries.some((entry: any) => entry.customType === "worktree" && entry.data?.active === true),
		).toBe(true);
		expect(loadRegistry(repo, testConfig()).worktrees.map((record) => record.path)).toContain(canonicalize(dir));
	});

	test("refuses a name whose path escapes the managed directory", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);
		await expect(harness.run(WORKTREE_TOOLS.enter, { name: join(tmpdir(), "pi-wt-escape") })).rejects.toThrow(
			/outside/,
		);
	});

	test("refuses to enter the main checkout by path", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);
		await expect(harness.run(WORKTREE_TOOLS.enter, { path: repo })).rejects.toThrow(/main checkout/i);
	});

	test("treats a declined outside-path entry as a normal cancellation", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const outsideBase = temps.track(mkdtempSync(join(tmpdir(), "pi-wt-out-")));
		const outside = join(outsideBase, "wt");
		await execP("git", ["worktree", "add", "-b", "outside-branch", outside], { cwd: repo });

		const harness = await bootWorktree(repo, { hasUI: true, confirm: false });
		const result = await harness.run(WORKTREE_TOOLS.enter, { path: outside });
		expect(result.content[0].text).toMatch(/cancelled/i);
		expect(result.details.cancelled).toBe(true);
		expect(harness.ctx.statuses.has("worktree")).toBe(false);
	});

	test("re-enters a worktree whose branch was kept on exit", async () => {
		const repo = temps.track(await makeRepo("pi-wt-enter-"));
		const harness = await bootWorktree(repo);

		await harness.run(WORKTREE_TOOLS.enter, { name: "reuse" });
		const dir = worktreePath(repo, "reuse");
		writeFileSync(join(dir, "work.txt"), "x");
		await harness.run(WORKTREE_TOOLS.exit, { remove: true, keepBranch: true });

		const reentered = await harness.run(WORKTREE_TOOLS.enter, { name: "reuse" });
		expect(reentered.content[0].text).toContain("Entered worktree");
		await harness.run(WORKTREE_TOOLS.exit, { remove: true, keepBranch: true });
	});
});

describe("borrowed worktree (subagent)", () => {
	test("binds to the inherited root and refuses to change it", async () => {
		const repo = temps.track(await makeRepo("pi-wt-borrow-"));

		// Leave a kept worktree behind, as the parent session would.
		const parent = await bootWorktree(repo);
		await parent.run(WORKTREE_TOOLS.enter, { name: "borrow" });
		await parent.run(WORKTREE_TOOLS.exit, { remove: false });
		const dir = worktreePath(repo, "borrow");

		const child = await bootWorktree(repo, {
			env: { root: dir, branch: "worktree-borrow", main: repo },
		});
		expect(child.ctx.statuses.get("worktree")).toContain("borrow");

		const status = await child.run(WORKTREE_TOOLS.list, {});
		expect(status.content[0].text).toContain(canonicalize(repo));

		await expect(child.run(WORKTREE_TOOLS.enter, { name: "x" })).rejects.toThrow(/inherited/i);
		await expect(child.run(WORKTREE_TOOLS.exit, {})).rejects.toThrow(/inherited|parent/i);

		const handler = child.pi.handlers.get("tool_call")[0];
		expect(handler({ toolName: "write", input: { path: join(repo, "outside.txt") } })).toMatchObject({
			block: true,
		});
		expect(handler({ toolName: "write", input: { path: "inside.txt" } })).toBeUndefined();
		expect(handler({ toolName: "bash", input: { command: `git -C ${repo} status` } })).toMatchObject({ block: true });
		expect(handler({ toolName: "bash", input: { command: "git status" } })).toBeUndefined();

		await execP("git", ["worktree", "remove", "--force", dir], { cwd: repo });
	});
});
