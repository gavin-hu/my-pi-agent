import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
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

		const mounts = await review(ctx, [{ kind: "revert", path: "after.txt" }, undefined]);

		expect(mounts).toBe(2);
		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("changed\n");
		expect(ctx.notices.at(-1)?.message).toContain("Reverted 1 file.");
		expect(ctx.confirms.at(-1)?.title).toBe("Revert after.txt?");
		expect(await rewindRefs(repo)).toHaveLength(2);
		expect((await rewindMetadata(repo)).some((meta) => meta.reason === "pre-restore")).toBe(true);
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

		await review(ctx, [{ kind: "revertAll" }]);

		expect(existsSync(join(repo, "after.txt"))).toBe(false);
		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(ctx.notices.at(-1)?.message).toContain("No changes remain.");
		expect(ctx.confirms.at(-1)?.title).toBe("Revert all 2 files?");
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

		await review(ctx, [{ kind: "revert", path: "after.txt" }, undefined]);

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
			{ kind: "diff", path: "README.md" },
			"back",
			{ kind: "diff", path: "README.md" },
			"revert",
			undefined,
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

		await review(ctx, [{ kind: "revert", path: "second.txt" }, undefined]);

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
