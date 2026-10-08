import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSnapshot, type SnapshotInput } from "../../extensions/rewind/snapshot.ts";
import { cleanup, indexFileFor, makeRepo, runGit } from "./helpers.ts";

const cleanups: string[] = [];
afterAll(() => cleanup(...cleanups));

const NS = "refs/pi/rewind";

function input(repo: string, overrides: Partial<SnapshotInput> = {}): SnapshotInput {
	return {
		root: repo,
		indexFile: indexFileFor(repo),
		namespace: NS,
		reason: "manual",
		includeUntracked: true,
		sessionId: "session-1",
		entryId: null,
		...overrides,
	};
}

describe("createSnapshot", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await makeRepo("pi-rw-snap-");
		cleanups.push(repo);
	});

	test("captures tracked modifications and untracked files", async () => {
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		const snapshot = await createSnapshot({ runGit, now: () => 1000, idFactory: () => "t-dirty" }, input(repo));

		expect(snapshot.id).toBe("t-dirty");
		expect(snapshot.clean).toBe(false);
		expect(snapshot.branch).toBe("main");
		expect(snapshot.ref).toBe(`${NS}/t-dirty`);
		// The untracked file is present in the snapshot tree.
		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:new.txt`], { cwd: repo })).code).toBe(0);
		// The modified tracked file is captured with its new contents.
		const blob = await runGit(["show", `${snapshot.commit}:README.md`], { cwd: repo });
		expect(blob.stdout).toBe("changed\n");
	});

	test("records a metadata commit sharing HEAD's tree when clean", async () => {
		await runGit(["reset", "--hard", "-q", "HEAD"], { cwd: repo });
		await runGit(["clean", "-fdq"], { cwd: repo });
		const snapshot = await createSnapshot(
			{ runGit, now: () => 2000, idFactory: () => "t-clean" },
			input(repo, { reason: "auto" }),
		);

		expect(snapshot.clean).toBe(true);
		// Git reuses the identical tree object; only a small commit is added.
		const tree = (await runGit(["rev-parse", `${snapshot.commit}^{tree}`], { cwd: repo })).stdout.trim();
		const headTree = (await runGit(["rev-parse", "HEAD^{tree}"], { cwd: repo })).stdout.trim();
		expect(tree).toBe(headTree);
		expect(snapshot.commit).not.toBe(snapshot.head);
	});

	test("excludes ignored files but captures .gitignore itself", async () => {
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");
		const snapshot = await createSnapshot({ runGit, now: () => 3000, idFactory: () => "t-ignore" }, input(repo));

		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:ignored.txt`], { cwd: repo })).code).not.toBe(0);
		expect((await runGit(["cat-file", "-e", `${snapshot.commit}:.gitignore`], { cwd: repo })).code).toBe(0);
	});

	test("leaves the real index and HEAD untouched", async () => {
		writeFileSync(join(repo, "staged.txt"), "staged\n");
		await runGit(["add", "staged.txt"], { cwd: repo });
		const stagedBefore = await runGit(["diff", "--cached", "--name-only"], { cwd: repo });
		const headBefore = await runGit(["rev-parse", "HEAD"], { cwd: repo });

		await createSnapshot({ runGit, now: () => 4000, idFactory: () => "t-index" }, input(repo));

		expect((await runGit(["diff", "--cached", "--name-only"], { cwd: repo })).stdout).toBe(stagedBefore.stdout);
		expect((await runGit(["rev-parse", "HEAD"], { cwd: repo })).stdout).toBe(headBefore.stdout);
	});

	test("records the prompt summary, session, and conversation anchor", async () => {
		const snapshot = await createSnapshot(
			{ runGit, now: () => 5000, idFactory: () => "t-prompt" },
			input(repo, { reason: "auto", prompt: "fix the list", sessionId: "session-9", entryId: "entry-7" }),
		);

		expect(snapshot.prompt).toBe("fix the list");
		expect(snapshot.sessionId).toBe("session-9");
		expect(snapshot.entryId).toBe("entry-7");
	});

	test("refuses a repository with no commits", async () => {
		const empty = await makeRepo("pi-rw-empty-");
		cleanups.push(empty);
		await runGit(["update-ref", "-d", "HEAD"], { cwd: empty });
		await expect(createSnapshot({ runGit }, input(empty))).rejects.toThrow(/no commits/);
	});
});
