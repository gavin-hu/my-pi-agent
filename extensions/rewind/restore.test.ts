import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyRestore, planRestore } from "./restore.ts";
import { createSnapshot } from "./snapshot.ts";
import { cleanup, makeRepo } from "../../test/helpers/git.ts";
import { indexFileFor, runGit, snapshotInput } from "../../test/helpers/fixtures/rewind.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

describe.skipIf(!runSlowSuites)("rewind", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-rw-restore-");
		cleanups.push(repo);
		writeFileSync(join(repo, "keep.txt"), "keep\n");
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		await runGit(["add", "."], { cwd: repo });
		await runGit(["commit", "-qm", "keep"], { cwd: repo });
	});

	test("plan and apply restore modified/deleted files and remove added ones", async () => {
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "r1" }, snapshotInput(repo));

		writeFileSync(join(repo, "README.md"), "changed\n");
		rmSync(join(repo, "keep.txt"));
		writeFileSync(join(repo, "new.txt"), "new\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");
		const headBefore = (await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();

		const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.changed).toBe(2);
		expect(plan.plan.removed).toBe(1);
		expect(plan.plan.diff).toContain("README.md");
		expect(plan.plan.diff).not.toContain("ignored.txt");
		expect(plan.plan.currentTree).toMatch(/^[0-9a-f]{40,64}$/);

		const summary = await applyRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
		expect(summary.changed).toBe(2);
		expect(summary.removed).toBe(1);

		expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe("hello\n");
		expect(readFileSync(join(repo, "keep.txt"), "utf-8")).toBe("keep\n");
		expect(existsSync(join(repo, "new.txt"))).toBe(false);
		// Ignored files are never part of a snapshot, so a rewind leaves them alone.
		expect(existsSync(join(repo, "ignored.txt"))).toBe(true);
		// HEAD never moves.
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout.trim()).toBe(headBefore);
		expect((await runGit(["log", "-1", "--format=%s"], { cwd: repo })).stdout.trim()).toBe("keep");
	});

	test("leaves untracked files alone and reverts tracked ones when the snapshot excluded them", async () => {
		const fresh = await makeRepo("pi-rw-restore-excl-");
		cleanups.push(fresh);
		const snapshot = await createSnapshot(
			{ runGit, now: () => 1000, idFactory: () => "e1" },
			snapshotInput(fresh, { includeUntracked: false }),
		);
		// A tracked edit must still be captured and reverted even though the
		// snapshot holds no untracked files. This guards the empty-tree
		// regression, where the snapshot captured nothing and the rewind was a
		// silent no-op.
		writeFileSync(join(fresh, "README.md"), "tracked edit\n");
		writeFileSync(join(fresh, "later.txt"), "later\n");
		const plan = await planRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: snapshot });
		expect(plan.ok && plan.plan.removed).toBe(0);
		expect(plan.ok && plan.plan.changed).toBe(1);
		await applyRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: snapshot });
		expect(existsSync(join(fresh, "later.txt"))).toBe(true);
		expect(readFileSync(join(fresh, "README.md"), "utf-8")).not.toBe("tracked edit\n");
	});

	test("refuses while a merge is in progress", async () => {
		const snapshot = await createSnapshot({ runGit, now: () => 2000, idFactory: () => "r2" }, snapshotInput(repo));
		const mergeHead = (await runGit(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: repo })).stdout.trim();
		writeFileSync(join(repo, mergeHead), "0000000000000000000000000000000000000000\n");
		try {
			const plan = await planRestore({ runGit }, { root: repo, indexFile: indexFileFor(repo), target: snapshot });
			expect(plan.ok).toBe(false);
			if (!plan.ok) expect(plan.reason).toContain("merge");
		} finally {
			rmSync(join(repo, mergeHead), { force: true });
		}
	});

	test("a partial restore rewrites only the selected paths", async () => {
		const partial = await makeRepo("pi-rw-restore-partial-");
		cleanups.push(partial);
		mkdirSync(join(partial, "src"), { recursive: true });
		writeFileSync(join(partial, "a.txt"), "a1\n");
		writeFileSync(join(partial, "src", "b.txt"), "b1\n");
		writeFileSync(join(partial, "src", "gone.txt"), "gone1\n");
		await runGit(["add", "."], { cwd: partial });
		await runGit(["commit", "-qm", "base"], { cwd: partial });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "p1" }, snapshotInput(partial));

		writeFileSync(join(partial, "a.txt"), "a2\n");
		writeFileSync(join(partial, "src", "b.txt"), "b2\n");
		rmSync(join(partial, "src", "gone.txt"));
		writeFileSync(join(partial, "src", "added.txt"), "new\n");

		const all = await planRestore({ runGit }, { root: partial, indexFile: indexFileFor(partial), target: snapshot });
		expect(all.ok && all.plan.changed).toBe(3);
		expect(all.ok && all.plan.removed).toBe(1);

		const subset = ["a.txt", "src/added.txt"];
		const plan = await planRestore(
			{ runGit },
			{ root: partial, indexFile: indexFileFor(partial), target: snapshot, paths: subset },
		);
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.plan.paths.map((entry) => entry.path).sort()).toEqual(["a.txt", "src/added.txt"]);
		expect(plan.plan.changed).toBe(1);
		expect(plan.plan.removed).toBe(1);
		expect(plan.plan.diff).toContain("a.txt");
		expect(plan.plan.diff).not.toContain("b.txt");

		const summary = await applyRestore(
			{ runGit },
			{ root: partial, indexFile: indexFileFor(partial), target: snapshot, paths: subset },
		);
		expect(summary.changed).toBe(1);
		expect(summary.removed).toBe(1);
		// The subset says how much of the whole diff it covers.
		expect(summary.of).toBe(4);

		expect(readFileSync(join(partial, "a.txt"), "utf-8")).toBe("a1\n");
		expect(existsSync(join(partial, "src", "added.txt"))).toBe(false);
		// Unselected paths keep the post-snapshot state, deletion included.
		expect(readFileSync(join(partial, "src", "b.txt"), "utf-8")).toBe("b2\n");
		expect(existsSync(join(partial, "src", "gone.txt"))).toBe(false);
		// The real index never sees the restore, partial or not.
		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: partial })).stdout.trim()).toBe("");
	});

	test("a partial restore of a deletion brings the file back", async () => {
		const back = await makeRepo("pi-rw-restore-undelete-");
		cleanups.push(back);
		writeFileSync(join(back, "keep.txt"), "keep1\n");
		await runGit(["add", "."], { cwd: back });
		await runGit(["commit", "-qm", "base"], { cwd: back });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "u1" }, snapshotInput(back));

		rmSync(join(back, "keep.txt"));
		await applyRestore(
			{ runGit },
			{ root: back, indexFile: indexFileFor(back), target: snapshot, paths: ["keep.txt"] },
		);

		expect(readFileSync(join(back, "keep.txt"), "utf-8")).toBe("keep1\n");
	});

	test("a path with a glob character restores literally", async () => {
		const weird = await makeRepo("pi-rw-restore-glob-");
		cleanups.push(weird);
		writeFileSync(join(weird, "weird[1].txt"), "one\n");
		await runGit(["add", "."], { cwd: weird });
		await runGit(["commit", "-qm", "base"], { cwd: weird });
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "g1" }, snapshotInput(weird));

		writeFileSync(join(weird, "weird[1].txt"), "two\n");
		await applyRestore(
			{ runGit },
			{ root: weird, indexFile: indexFileFor(weird), target: snapshot, paths: ["weird[1].txt"] },
		);

		expect(readFileSync(join(weird, "weird[1].txt"), "utf-8")).toBe("one\n");
	});

	test("restores nested files without touching siblings", async () => {
		// A well-formed snapshot from a normal repo restores a nested file in place.
		const fresh = await makeRepo("pi-rw-restore-nested-");
		cleanups.push(fresh);
		mkdirSync(join(fresh, "sub"), { recursive: true });
		writeFileSync(join(fresh, "sub", "file.txt"), "x\n");
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "x1" }, snapshotInput(fresh));
		writeFileSync(join(fresh, "sub", "file.txt"), "changed\n");
		await applyRestore({ runGit }, { root: fresh, indexFile: indexFileFor(fresh), target: snapshot });
		expect(readFileSync(join(fresh, "sub", "file.txt"), "utf-8")).toBe("x\n");
	});
});
