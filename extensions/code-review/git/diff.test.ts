/**
 * The reader: a branch against its base, the last commit, the index, and the tree.
 *
 * A real repository is built per case, because everything this module decides is
 * an answer git gives — the range's file list, a rename's letter, an untracked
 * file's all-add body — and a stub would only restate the parser. The seam is
 * the suite's own `git` process, which is what the page hands it in production.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunGit } from "../../../lib/git/index.ts";
import { execP, makeRepo, makeTempTracker } from "../../../test/helpers/git.ts";
import { createReviewReaderFrom, NO_BASE, NO_COMMITS, NO_PARENT, NOT_A_REPOSITORY, parseNameStatusZ } from "./diff.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The production seam, over the suite's own git process. */
const run: RunGit = (args, options) => execP("git", args, { cwd: options.cwd, env: options.env });

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

describe("a base review", () => {
	test("reads the branch's commits against its base, and counts what it shows", async () => {
		const repo = await featureRepo();
		const outcome = await createReviewReaderFrom(run, repo, { base: "main" }).snapshot("base");
		expect(outcome.kind).toBe("snapshot");
		if (outcome.kind !== "snapshot") return;
		const { snapshot } = outcome;
		expect(snapshot.label).toBe("main...HEAD");
		expect(snapshot.base).toBe("main");
		expect(snapshot.files.map((file) => [file.rel, file.status])).toEqual([["a.ts", "A"]]);
		expect(snapshot.files[0].add).toBe(2);
		expect(snapshot.insertions).toBe(2);
		expect(snapshot.deletions).toBe(0);
		expect(snapshot.files[0].lines.some((line) => line.kind === "add" && line.text === "const a = 1;")).toBe(true);
	});

	test("detects the base when the section names none, and refuses when none resolves", async () => {
		const repo = await featureRepo();
		expect(await createReviewReaderFrom(run, repo).baseRef()).toBe("main");
		const missing = await createReviewReaderFrom(run, repo, { base: "no-such-branch" }).snapshot("base");
		expect(missing).toEqual({ kind: "failed", message: NO_BASE });
	});

	test("answers the same fingerprint for the same tree, and a new one after a commit", async () => {
		const repo = await featureRepo();
		const reader = createReviewReaderFrom(run, repo, { base: "main" });
		const first = await reader.snapshot("base");
		const second = await reader.snapshot("base");
		if (first.kind !== "snapshot" || second.kind !== "snapshot") throw new Error("expected snapshots");
		expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
		writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
		await execP("git", ["add", "b.ts"], { cwd: repo });
		await execP("git", ["commit", "-qm", "add b"], { cwd: repo });
		const third = await reader.snapshot("base");
		if (third.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(third.snapshot.fingerprint).not.toBe(first.snapshot.fingerprint);
	});
});

describe("the other four scopes", () => {
	test("the last commit reads HEAD~1...HEAD, and refuses before HEAD has a parent", async () => {
		const repo = await featureRepo();
		const outcome = await createReviewReaderFrom(run, repo).snapshot("last");
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.files.map((file) => file.rel)).toEqual(["a.ts"]);

		const fresh = temps.track(await makeRepo());
		expect(await createReviewReaderFrom(run, fresh).snapshot("last")).toEqual({
			kind: "failed",
			message: NO_PARENT,
		});
	});

	test("staged reads the index and leaves an untracked file out", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "note.txt"), "new\n");
		const outcome = await createReviewReaderFrom(run, repo).snapshot("staged");
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.files.map((file) => [file.rel, file.status])).toEqual([["README.md", "M"]]);
		expect(outcome.snapshot.insertions).toBe(1);
	});

	test("worktree reads the unstaged change and an untracked file as all-add", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 3;\n");
		writeFileSync(join(repo, "note.txt"), "one\ntwo\n");
		const outcome = await createReviewReaderFrom(run, repo).snapshot("worktree");
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		const byPath = new Map(outcome.snapshot.files.map((file) => [file.rel, file]));
		expect([...byPath.keys()].sort()).toEqual(["a.ts", "note.txt"]);
		expect(byPath.get("a.ts")?.add).toBe(1);
		expect(byPath.get("a.ts")?.del).toBe(1);
		expect(byPath.get("note.txt")?.status).toBe("?");
		expect(byPath.get("note.txt")?.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});

	test("head reads the index and the tree together, with an untracked file", async () => {
		const repo = await featureRepo();
		writeFileSync(join(repo, "README.md"), "hello\nstaged\n");
		await execP("git", ["add", "README.md"], { cwd: repo });
		writeFileSync(join(repo, "a.ts"), "const a = 1;\nconst b = 3;\n");
		writeFileSync(join(repo, "note.txt"), "one\n");
		const outcome = await createReviewReaderFrom(run, repo).snapshot("head");
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.label).toBe("uncommitted");
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
		const reader = createReviewReaderFrom(run, repo, { maxFiles: 1, maxLines: 5 });
		const outcome = await reader.snapshot("worktree");
		if (outcome.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(outcome.snapshot.files).toHaveLength(1);
		expect(outcome.snapshot.omitted).toBeGreaterThan(0);
		const big = await createReviewReaderFrom(run, repo, { maxLines: 5 }).snapshot("worktree");
		if (big.kind !== "snapshot") throw new Error("expected a snapshot");
		const file = big.snapshot.files.find((entry) => entry.rel === "big.txt");
		expect(file?.truncated).toBe(true);
		expect(file?.lines.length).toBeLessThanOrEqual(5);
	});
});

describe("a tree with no answer", () => {
	test("refuses outside a repository", async () => {
		const outside = temps.track(mkdtempSync(join(tmpdir(), "pi-review-plain-")));
		expect(await createReviewReaderFrom(run, outside).snapshot("base")).toEqual({
			kind: "failed",
			message: NOT_A_REPOSITORY,
		});
	});

	test("refuses before the first commit", async () => {
		const empty = temps.track(mkdtempSync(join(tmpdir(), "pi-review-empty-")));
		await execP("git", ["init", "-q", "-b", "main"], { cwd: empty });
		for (const scope of ["staged", "head"] as const) {
			expect(await createReviewReaderFrom(run, empty).snapshot(scope)).toEqual({
				kind: "failed",
				message: NO_COMMITS,
			});
		}
	});
});
