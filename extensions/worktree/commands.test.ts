import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { bootWorktree, type WorktreeHarness } from "../../test/helpers/fixtures/worktree.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function worktreePath(repo: string, name: string): string {
	return join(repo, ".pi", "worktrees", name);
}

async function withHarness(prefix = "pi-wt-cmd-"): Promise<{ harness: WorktreeHarness; repo: string }> {
	const repo = temps.track(await makeRepo(prefix));
	const harness = await bootWorktree(repo);
	return { harness, repo };
}

describe("/worktree command", () => {
	test("reports not in a worktree for the bare command and status", async () => {
		const { harness } = await withHarness();
		await harness.command("");
		expect(harness.ctx.notices.at(-1)).toContain("Not in a worktree.");
		await harness.command("status");
		expect(harness.ctx.notices.at(-1)).toContain("Not in a worktree.");
	});

	test("enters a worktree for enter <name>", async () => {
		const { harness, repo } = await withHarness();
		await harness.command("enter cmd");
		expect(harness.ctx.notices.at(-1)).toContain("Entered worktree");
		expect(existsSync(worktreePath(repo, "cmd"))).toBe(true);
	});

	test("keeps the current worktree for prune", async () => {
		const { harness } = await withHarness();
		await harness.command("enter pruner");
		await harness.command("prune");
		expect(harness.ctx.notices.at(-1)).toContain("Kept");
		expect(harness.ctx.notices.at(-1)).toContain("current");
	});

	test("removes the worktree for exit --remove", async () => {
		const { harness, repo } = await withHarness();
		await harness.command("enter leaver");
		await harness.command("exit --remove");
		expect(harness.ctx.notices.at(-1)).toContain("Removed worktree");
		expect(existsSync(worktreePath(repo, "leaver"))).toBe(false);
	});

	test("rejects an unknown subcommand with usage", async () => {
		const { harness } = await withHarness();
		await harness.command("bogus");
		expect(harness.ctx.notices.at(-1)).toContain('Unknown worktree subcommand "bogus"');
		expect(harness.ctx.notices.at(-1)).toContain("Usage: /worktree");
	});
});

describe("/worktree completion", () => {
	function completions(harness: WorktreeHarness, prefix: string): any {
		return harness.pi.commands.get("worktree").getArgumentCompletions(prefix);
	}

	test("lists every subcommand for an empty prefix", async () => {
		const { harness } = await withHarness();
		expect(completions(harness, "").map((item: any) => item.value)).toEqual(["status ", "enter ", "exit ", "prune "]);
	});

	test("filters subcommands by prefix", async () => {
		const { harness } = await withHarness();
		expect(completions(harness, "e").map((item: any) => item.label)).toEqual(["enter", "exit"]);
	});

	test("completes exit flags", async () => {
		const { harness } = await withHarness();
		expect(completions(harness, "exit ").map((item: any) => item.label)).toEqual(["--keep", "--remove"]);
		expect(completions(harness, "exit --k").map((item: any) => item.label)).toEqual(["--keep"]);
		const remove = completions(harness, "exit ").find((item: any) => item.label === "--remove");
		expect(remove.description).toMatch(/force|discard/i);
	});

	test("offers no completion for enter", async () => {
		const { harness } = await withHarness();
		expect(completions(harness, "enter ")).toBeNull();
	});
});
