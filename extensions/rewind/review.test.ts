import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import type { ReviewListResult } from "./review-tui.ts";
import { createSnapshot } from "./snapshot.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import {
	branchWithUser,
	cleanup,
	makeCtx,
	makeRepo,
	primeRewind,
	rewindMetadata,
	rewindRefs,
	runGit,
	setupRewind,
	snapshotInput,
	WRITE_TOOL,
} from "../../test/helpers/fixtures/rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

/** One recorded list close: an optional action and the selection it carried. */
function screen(action?: ReviewListResult["action"], selected: string[] = []): ReviewListResult {
	return { action, selected };
}

/** Script the custom screens and run the command, returning how many mounted. */
async function review(ctx: any, actions: unknown[]): Promise<number> {
	const queue = [...actions];
	let mounts = 0;
	ctx.ui.custom = async (_factory: unknown) => {
		mounts += 1;
		return queue.shift();
	};
	await ctx.command.handler("", ctx);
	return mounts;
}

/** A branch with two user prompts, for the latest-snapshot test. */
function twoPromptBranch() {
	return [
		...branchWithUser("e1", "first task"),
		{
			type: "message",
			id: "e2",
			parentId: "e1",
			timestamp: "1970-01-01T00:00:02.000Z",
			message: { role: "user", content: "second task", timestamp: 2000 },
		},
	];
}

describe.skipIf(!runSlowSuites)("/review command", () => {
	test("reverts one changed file and keeps the safety snapshot", async () => {
		const repo = await makeRepo("pi-rw-review-one-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		writeFileSync(join(repo, "README.md"), "changed\n");

		const mounts = await review(ctx, [screen({ kind: "revert", paths: ["after.txt"] }), screen()]);

		expect(mounts).toBe(2);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("changed\n");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file.");
		expect(ctx.confirms.at(-1)?.title).toBe("Revert after.txt?");
		expect(await rewindRefs(repo)).toHaveLength(2);
		expect((await rewindMetadata(repo)).some((meta) => meta.reason === "pre-restore")).toBe(true);
	});

	test("reverts a selection in one restore with one safety snapshot", async () => {
		const repo = await makeRepo("pi-rw-review-batch-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "third.txt"), "third\n");

		const mounts = await review(ctx, [
			screen({ kind: "revert", paths: ["README.md", "after.txt"] }, ["README.md", "after.txt"]),
			screen(),
		]);

		expect(mounts).toBe(2);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(existsSync(join(repo, "third.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.title).toBe("Revert 2 selected files?");
		expect(ctx.confirms.at(-1)?.message).toContain("Other changed files stay as they are");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 2 files.");
		// One auto snapshot plus one pre-restore snapshot for the whole batch.
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("names committed changes and leaves the commit in place", async () => {
		const repo = await makeRepo("pi-rw-review-committed-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		rmSync(join(repo, "after.txt"));
		writeFileSync(join(repo, "README.md"), "changed\n");
		await runGit(["add", "-A"], { cwd: repo });
		await runGit(["commit", "-qm", "turn"], { cwd: repo });

		const mounts = await review(ctx, [screen({ kind: "revert", paths: ["README.md"] })]);

		expect(mounts).toBe(1);
		expect(ctx.confirms.at(-1)?.message).toContain("already committed");
		expect(ctx.confirms.at(-1)?.message).toContain("leaves the commits in place");
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect((await runGit(["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim()).toBe("turn");
		expect((await runGit(["status", "--short"], { cwd: repo })).stdout).toContain("README.md");
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("reverts every changed path with R", async () => {
		const repo = await makeRepo("pi-rw-review-all-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		writeFileSync(join(repo, "README.md"), "changed\n");

		await review(ctx, [screen({ kind: "revertAll" })]);

		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(ctx.notices.at(-1)?.message).toContain("No changes remain.");
		expect(ctx.confirms.at(-1)?.title).toBe("Revert all 2 files?");
	});

	test("reverts a rename as one row, restoring both sides", async () => {
		const repo = await makeRepo("pi-rw-review-rename-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		await runGit(["mv", "README.md", "renamed.md"], { cwd: repo });

		const mounts = await review(ctx, [screen({ kind: "revert", paths: ["renamed.md"] }), screen()]);

		expect(mounts).toBe(2);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "renamed.md"))).toBe(false);
		// The unrelated creation stays until it is reverted on its own.
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.title).toBe("Revert renamed.md?");
		expect(ctx.confirms.at(-1)?.message).toContain("renamed from README.md");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file.");
	});

	test("R reverts a rename together with the other changes", async () => {
		const repo = await makeRepo("pi-rw-review-rename-all-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		await runGit(["mv", "README.md", "renamed.md"], { cwd: repo });

		await review(ctx, [screen({ kind: "revertAll" })]);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(existsSync(join(repo, "renamed.md"))).toBe(false);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(ctx.confirms.at(-1)?.title).toBe("Revert all 2 files?");
		expect(ctx.notices.at(-1)?.message).toContain("No changes remain.");
	});

	test("reverts only the chosen hunk of a modified file", async () => {
		const repo = await makeRepo("pi-rw-review-hunks-");
		cleanups.push(repo);
		const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
		writeFileSync(join(repo, "two.txt"), `${lines.join("\n")}\n`);
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "base"], { cwd: repo });

		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		const changed = lines.map((line, index) => (index === 1 ? "changed one" : index === 15 ? "changed two" : line));
		writeFileSync(join(repo, "two.txt"), `${changed.join("\n")}\n`);

		const mounts = await review(ctx, [screen({ kind: "diff", path: "two.txt" }), "hunks", [0], screen()]);

		expect(mounts).toBe(4);
		const after = readFileSync(join(repo, "two.txt"), "utf-8").split("\n");
		expect(after[1]).toBe("line 2");
		expect(after[15]).toBe("changed two");
		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.confirms.at(-1)?.title).toBe("Revert 1 hunk in two.txt?");
		expect(ctx.confirms.at(-1)?.message).toContain("1 of 2 hunks");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 hunk in two.txt.");
		// The automatic snapshot plus one pre-restore safety snapshot.
		expect(await rewindRefs(repo)).toHaveLength(2);
	});

	test("a declined confirmation leaves the file and reopens the list", async () => {
		const repo = await makeRepo("pi-rw-review-cancel-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
			confirm: false,
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);

		await review(ctx, [screen({ kind: "revert", paths: ["after.txt"] }), screen()]);

		expect(existsSync(join(repo, "after.txt"))).toBe(true);
		expect(ctx.notices.some((notice: { message: string }) => notice.message.includes("Reverted"))).toBe(false);
	});

	test("opens a diff, goes back, then reverts from the diff", async () => {
		const repo = await makeRepo("pi-rw-review-diff-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);
		writeFileSync(join(repo, "README.md"), "changed\n");

		const mounts = await review(ctx, [
			screen({ kind: "diff", path: "README.md" }),
			"back",
			screen({ kind: "diff", path: "README.md" }),
			"revert",
			screen(),
		]);

		expect(mounts).toBe(5);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file.");
	});

	test("uses the newest prompt's snapshot, not an older one", async () => {
		const repo = await makeRepo("pi-rw-review-latest-");
		cleanups.push(repo);
		await createSnapshot(
			{ runGit, now: () => 1000, idFactory: () => "first" },
			snapshotInput(repo, { entryId: "e1", sessionId: "s1" }),
		);
		writeFileSync(join(repo, "first.txt"), "first\n");
		await createSnapshot(
			{ runGit, now: () => 2000, idFactory: () => "second" },
			snapshotInput(repo, { entryId: "e2", sessionId: "s1" }),
		);
		writeFileSync(join(repo, "second.txt"), "second\n");

		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: twoPromptBranch(),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");

		await review(ctx, [screen({ kind: "revert", paths: ["second.txt"] }), screen()]);

		expect(existsSync(join(repo, "second.txt"))).toBe(false);
		expect(existsSync(join(repo, "first.txt"))).toBe(true);
	});

	test("reports no snapshot and no changes", async () => {
		const noSnapshot = await makeRepo("pi-rw-review-none-");
		cleanups.push(noSnapshot);
		const fake = setupRewind([WRITE_TOOL]);
		const emptyCtx = makeCtx(fake, {
			cwd: noSnapshot,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		emptyCtx.command = fake.commands.get("review");

		await review(emptyCtx, []);
		expect(emptyCtx.notices.at(-1)?.message).toContain("No prompt with a code snapshot");

		const clean = await makeRepo("pi-rw-review-clean-");
		cleanups.push(clean);
		const primed = setupRewind([WRITE_TOOL]);
		const cleanCtx = makeCtx(primed, {
			cwd: clean,
			hasUI: true,
			mode: "tui",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		cleanCtx.command = primed.commands.get("review");
		await primeRewind(primed, cleanCtx);
		rmSync(join(clean, "after.txt"));
		await review(cleanCtx, []);
		expect(cleanCtx.notices.at(-1)?.message).toContain("No changes since the snapshot");
	});

	test("refuses while plan mode is on", async () => {
		const repo = await makeRepo("pi-rw-review-plan-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: true,
			mode: "tui",
			branch: [...branchWithUser("e1"), { type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");

		const mounts = await review(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("prints the changed list outside the TUI", async () => {
		const repo = await makeRepo("pi-rw-review-print-");
		cleanups.push(repo);
		const fake = setupRewind([WRITE_TOOL]);
		const ctx = makeCtx(fake, {
			cwd: repo,
			hasUI: false,
			mode: "print",
			branch: branchWithUser("e1"),
			sessionId: "s1",
		});
		ctx.command = fake.commands.get("review");
		await primeRewind(fake, ctx);

		const mounts = await review(ctx, []);

		expect(mounts).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain('Reviewing after "do the task"');
		expect(ctx.notices.at(-1)?.message).toContain("after.txt");
	});
});
