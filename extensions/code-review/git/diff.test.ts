/**
 * The reader: a scope's two sides read against each other.
 *
 * A real repository is built per case, because everything this module decides is an answer
 * git gives — a range's file list, a rename's letter, an untracked file's all-add body — and
 * a stub would only restate the parser. The seam is the suite's own `git` process, which is
 * what the page hands it in production.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execP, makeRepo, makeRepoWithRemote, makeTempTracker, runGit } from "../../../test/helpers/git.ts";
import { comparisonOf } from "../../../test/helpers/review-scope.ts";
import { MAX_BASE_LENGTH } from "../scope.ts";
import {
	baseTooLong,
	baseUnresolved,
	createReviewReaderFrom,
	NO_BASE,
	NO_COMMITS,
	NO_PARENT,
	NO_TEXT,
	NOT_A_REPOSITORY,
	noSuchSide,
	parseNameStatusZ,
} from "./diff.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A repository on a `feature` branch with one commit the base does not carry. */
async function featureRepo(): Promise<string> {
	const repo = temps.track(await makeRepo());
	await execP("git", ["checkout", "-q", "-b", "feature"], { cwd: repo });
	writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 2;\n");
	await execP("git", ["add", "a.ts"], { cwd: repo });
	await execP("git", ["commit", "-qm", "add a"], { cwd: repo });
	return repo;
}

describe("parseNameStatusZ", () => {
	test("reads one letter per path, and a rename's destination", () => {
		expect(parseNameStatusZ("M\0a.ts\0A\0b.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0")).toEqual([
			{ rel: "a.ts", status: "M" },
			{ rel: "b.ts", status: "A" },
			{ rel: "new.ts", status: "R" },
			{ rel: "gone.ts", status: "D" },
		]);
	});

	test("reads nothing from an empty list", () => {
		expect(parseNameStatusZ("")).toEqual([]);
	});
});

describe("a branch review", () => {
	test("reads the commits against the base, and counts what it shows", async () => {
		const repo = await featureRepo();
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("branch"));
		expect(outcome.kind).toBe("snapshot");
		if (outcome.kind !== "snapshot") return;
		const { snapshot } = outcome;
		expect(snapshot.label).toBe("main...HEAD");
		expect(snapshot.files.map((file) => [file.rel, file.status])).toEqual([["a.ts", "A"]]);
		expect(snapshot.files[0]?.add).toBe(2);
		expect(snapshot.insertions).toBe(2);
		expect(snapshot.deletions).toBe(0);
		expect(snapshot.files[0]?.lines.some((line) => line.kind === "add" && line.text === "const a = 1;")).toBe(true);
		expect(snapshot.fromSha).toBeDefined();
		expect(snapshot.toSha).toBeDefined();
	});

	test("reads the whole change, uncommitted work and untracked files included", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "note.txt"), "new\n");
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("change"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("main → working tree");
		const byPath = new Map(outcome.snapshot.files.map((file) => [file.rel, file]));
		expect([...byPath.keys()].sort()).toEqual(["README.md", "a.ts", "note.txt"]);
		expect(byPath.get("README.md")?.add).toBe(1);
		expect(byPath.get("note.txt")?.status).toBe("?");
	});

	test("answers the same fingerprint for the same tree, and a new one after a commit", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(runGit, repo);
		const first = await reader.snapshot(comparisonOf("branch"));
		const second = await reader.snapshot(comparisonOf("branch"));
		if (first.kind !== "snapshot" || second.kind !== "snapshot") throw new Error("expected snapshots");
		expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
		writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
		await execP("git", ["add", "b.ts"], { cwd: repo });
		await execP("git", ["commit", "-qm", "add b"], { cwd: repo });
		const third = await reader.snapshot(comparisonOf("branch"));
		if (third.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(third.snapshot.fingerprint).not.toBe(first.snapshot.fingerprint);
	});

	test("keeps two scopes over one tree apart, even showing the same diff", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(runGit, repo);
		const branch = await reader.snapshot(comparisonOf("branch"));
		const change = await reader.snapshot(comparisonOf("change"));
		if (branch.kind !== "snapshot" || change.kind !== "snapshot") throw new Error("expected snapshots");
		// A clean tree means the two draw the same lines; the fingerprint still names the
		// comparison a write is graded against.
		expect(branch.snapshot.files.map((file) => file.rel)).toEqual(change.snapshot.files.map((file) => file.rel));
		expect(branch.snapshot.fingerprint).not.toBe(change.snapshot.fingerprint);
	});
});

describe("the default ref", () => {
	test("detects the base when the section names none", async () => {
		const repo = await featureRepo();
		expect(await createReviewReaderFrom(runGit, repo).baseRef()).toEqual({ kind: "ref", ref: "main" });
	});

	test("reads the default branch through its origin ref, as lib/git names it", async () => {
		const { repo, remote } = await makeRepoWithRemote();
		temps.track(remote);
		expect(await createReviewReaderFrom(runGit, repo).baseRef()).toEqual({ kind: "ref", ref: "origin/main" });
	});

	test("prefers the remote ref when origin/HEAD is gone and a local main exists", async () => {
		const { repo, remote } = await makeRepoWithRemote();
		temps.track(remote);
		await execP("git", ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], { cwd: repo });
		// The landing line's name is the local branch; the line a change lands on is the remote's.
		expect(await createReviewReaderFrom(runGit, repo).baseRef()).toEqual({ kind: "ref", ref: "origin/main" });
	});

	test("names a configured ref that does not resolve, rather than blaming the key", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(runGit, repo, { base: "no-such-branch" });
		expect(await reader.baseRef()).toEqual({ kind: "failed", message: baseUnresolved("no-such-branch") });
	});

	test("names the bound a configured ref passed, rather than cutting it to another ref", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(runGit, repo, { base: "x".repeat(MAX_BASE_LENGTH + 1) });
		expect(await reader.baseRef()).toEqual({ kind: "failed", message: baseTooLong(MAX_BASE_LENGTH + 1) });
	});

	test("refuses when the repository names no default branch", async () => {
		const repo = await featureRepo();
		await execP("git", ["branch", "-m", "main", "develop"], { cwd: repo });
		expect(await createReviewReaderFrom(runGit, repo).baseRef()).toEqual({ kind: "failed", message: NO_BASE });
	});
});

describe("the other presets", () => {
	test("the last commit reads HEAD^...HEAD, and refuses before HEAD has a parent", async () => {
		const repo = await featureRepo();
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("last"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("HEAD^...HEAD");
		expect(outcome.snapshot.files.map((file) => file.rel)).toEqual(["a.ts"]);

		const fresh = temps.track(await makeRepo());
		expect(await createReviewReaderFrom(runGit, fresh).snapshot(comparisonOf("last"))).toEqual({
			kind: "failed",
			message: NO_PARENT,
		});
	});

	test("staged reads the index and leaves an untracked file out", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "note.txt"), "new\n");
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("staged"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("HEAD → index");
		expect(outcome.snapshot.files.map((file) => [file.rel, file.status])).toEqual([["README.md", "M"]]);
		expect(outcome.snapshot.insertions).toBe(1);
	});

	test("worktree reads the unstaged change and an untracked file as all-add", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 3;\n");
		writeFileSync(join(repo, "note.txt"), "one\ntwo\n");
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("worktree"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("index → working tree");
		const byPath = new Map(outcome.snapshot.files.map((file) => [file.rel, file]));
		expect([...byPath.keys()].sort()).toEqual(["a.ts", "note.txt"]);
		expect(byPath.get("a.ts")?.add).toBe(1);
		expect(byPath.get("a.ts")?.del).toBe(1);
		expect(byPath.get("note.txt")?.status).toBe("?");
		expect(byPath.get("note.txt")?.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});

	test("uncommitted reads the index and the tree together, with an untracked file", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 3;\n");
		writeFileSync(join(repo, "note.txt"), "one\n");
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot(comparisonOf("uncommitted"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("HEAD → working tree");
		const byPath = new Map(outcome.snapshot.files.map((file) => [file.rel, file]));
		expect([...byPath.keys()].sort()).toEqual(["README.md", "a.ts", "note.txt"]);
		expect(byPath.get("README.md")?.add).toBe(1);
		expect(byPath.get("a.ts")?.add).toBe(1);
		expect(byPath.get("a.ts")?.del).toBe(1);
		expect(byPath.get("note.txt")?.status).toBe("?");
	});

	test("caps the file list and the lines, saying how much it left out", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "big.txt"), Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));
		writeFileSync(join(repo, "second.txt"), "s\n");
		const reader = createReviewReaderFrom(runGit, repo, { maxFiles: 1, maxLines: 5 });
		const outcome = await reader.snapshot(comparisonOf("worktree"));
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.files).toHaveLength(1);
		expect(outcome.snapshot.omitted).toBeGreaterThan(0);
		const big = await createReviewReaderFrom(runGit, repo, { maxLines: 5 }).snapshot(comparisonOf("worktree"));
		if (big.kind !== "snapshot") throw new Error("expected a snapshot");
		const file = big.snapshot.files.find((entry) => entry.rel === "big.txt");
		expect(file?.truncated).toBe(true);
		expect(file?.lines.length).toBeLessThanOrEqual(5);
	});
});

describe("a pair a reader names", () => {
	test("reads the change as staged so far, leaving the working tree out", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 3;\n");
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot({
			from: { kind: "rev", ref: "main" },
			to: { kind: "index" },
		});
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("main → index");
		const byPath = new Map(outcome.snapshot.files.map((file) => [file.rel, file]));
		expect([...byPath.keys()].sort()).toEqual(["README.md", "a.ts"]);
		// The unstaged edit to a.ts is not in the index, so it is not in this comparison.
		expect(byPath.get("a.ts")?.add).toBe(2);
	});

	test("reads a branch nobody has checked out", async () => {
		const repo = await featureRepo();
		await execP("git", ["checkout", "-q", "main"], { cwd: repo });
		const outcome = await createReviewReaderFrom(runGit, repo).snapshot({
			from: { kind: "rev", ref: "main" },
			to: { kind: "rev", ref: "feature" },
		});
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("main...feature");
		expect(outcome.snapshot.files.map((file) => file.rel)).toEqual(["a.ts"]);
	});

	test("refuses one side read twice, and a side the repository does not have", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(runGit, repo);
		expect(await reader.snapshot({ from: { kind: "rev", ref: "HEAD" }, to: { kind: "rev", ref: "HEAD" } })).toEqual({
			kind: "failed",
			message: expect.stringContaining("same side"),
		});
		expect(await reader.snapshot({ from: { kind: "rev", ref: "no-such-branch" }, to: { kind: "tree" } })).toEqual({
			kind: "failed",
			message: noSuchSide("no-such-branch"),
		});
	});
});

describe("a whole file's text", () => {
	test("reads it as context lines, and names a binary file, a cut file and a missing one", async () => {
		const repo = temps.track(await makeRepo());
		writeFileSync(join(repo, "a.ts"), "one\ntwo\n");
		writeFileSync(join(repo, "blob.bin"), Buffer.from([0x7f, 0x00, 0x01]));
		writeFileSync(join(repo, "long.txt"), "line\n".repeat(40));
		const reader = createReviewReaderFrom(runGit, repo, { maxFileBytes: 64 });
		// Both gutter numbers are the file's own, so the diff renderer draws the numbers a
		// reader compares against rather than a second numbering scheme.
		expect(await reader.text("a.ts")).toEqual({
			kind: "text",
			lines: [
				{ kind: "ctx", text: "one", oldNo: 1, newNo: 1 },
				{ kind: "ctx", text: "two", oldNo: 2, newNo: 2 },
			],
			binary: false,
			truncated: false,
			// A file read whole knows how much it holds, which is what the file view's cap names.
			totalLines: 2,
		});
		expect(await reader.text("blob.bin")).toEqual({ kind: "text", lines: [], binary: true, truncated: false });
		const long = await reader.text("long.txt");
		if (long.kind !== "text") throw new Error("expected text");
		expect(long.truncated).toBe(true);
		expect(long.lines.length).toBeLessThan(40);
		// The byte cap cut the read, so the whole file's line count is not known and is not guessed at.
		expect(long.totalLines).toBeUndefined();
		// A path the diff lists may be gone by the time the view asks for it.
		expect(await reader.text("gone.ts")).toEqual({ kind: "failed", message: NO_TEXT });
	});

	test("names the total a line cap left out, and the one a byte cap cannot", async () => {
		const repo = temps.track(await makeRepo());
		writeFileSync(join(repo, "five.txt"), "1\n2\n3\n4\n5\n");
		// The line cap shows the first two of five: the file was read whole, so the total is known.
		const capped = await createReviewReaderFrom(runGit, repo, { maxLines: 2 }).text("five.txt");
		if (capped.kind !== "text") throw new Error("expected text");
		expect(capped.lines).toHaveLength(2);
		expect(capped.truncated).toBe(true);
		expect(capped.totalLines).toBe(5);
		// No cap at all: nothing is missing, so the total is still the file's own count.
		const whole = await createReviewReaderFrom(runGit, repo).text("five.txt");
		if (whole.kind !== "text") throw new Error("expected text");
		expect(whole.truncated).toBe(false);
		expect(whole.totalLines).toBe(5);
	});
});

describe("a tree with no answer", () => {
	test("refuses outside a repository", async () => {
		const outside = temps.track(mkdtempSync(join(tmpdir(), "pi-review-plain-")));
		expect(await createReviewReaderFrom(runGit, outside).snapshot(comparisonOf("branch"))).toEqual({
			kind: "failed",
			message: NOT_A_REPOSITORY,
		});
	});
});

/**
 * A fresh repository: an index and a working tree, and no HEAD to name. The sides that read
 * the index and the tree render against the empty tree git compares them with; the sides
 * naming a commit refuse, and say which commit they are missing.
 */
describe("a repository with no commits", () => {
	async function unborn(): Promise<string> {
		const repo = temps.track(mkdtempSync(join(tmpdir(), "pi-review-unborn-")));
		await execP("git", ["init", "-q", "-b", "main"], { cwd: repo });
		writeFileSync(join(repo, "a.ts"), "const a = 1;\n");
		await execP("git", ["add", "a.ts"], { cwd: repo });
		return repo;
	}

	test("renders the index and the tree, with no commit to name", async () => {
		const repo = await unborn();
		const reader = createReviewReaderFrom(runGit, repo);
		const staged = await reader.snapshot(comparisonOf("staged"));
		if (staged.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(staged.snapshot.fromSha).toBeUndefined();
		expect(staged.snapshot.label).toBe("HEAD → index");
		expect(staged.snapshot.files.map((file) => [file.rel, file.add])).toEqual([["a.ts", 1]]);

		writeFileSync(join(repo, "note.txt"), "new\n");
		const worktree = await reader.snapshot(comparisonOf("worktree"));
		if (worktree.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(worktree.snapshot.files.map((file) => file.rel)).toContain("note.txt");

		// `HEAD` names the empty tree only where `--cached` already reads it: everything
		// uncommitted would need a diff against nothing, so it says which commit is missing.
		expect(await reader.snapshot(comparisonOf("uncommitted"))).toEqual({ kind: "failed", message: NO_COMMITS });
	});

	test("still refuses the comparisons that need a commit", async () => {
		const repo = await unborn();
		const reader = createReviewReaderFrom(runGit, repo);
		// No default branch resolves, so the two scopes built on it have no left end.
		expect(await reader.snapshot(comparisonOf("branch"))).toEqual({ kind: "failed", message: NO_COMMITS });
		expect(await reader.snapshot(comparisonOf("change"))).toEqual({ kind: "failed", message: NO_COMMITS });
		expect(await reader.snapshot(comparisonOf("last"))).toEqual({ kind: "failed", message: NO_COMMITS });
	});
});
