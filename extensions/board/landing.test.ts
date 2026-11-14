/**
 * The landing a close resolves: the merge that carried a review, and what the merge changed of
 * the work that review proved.
 *
 * The gate reads a repository rather than a card's word, so the cases here build real git
 * history. The one they exist for is a neighbour's landing: a card's `paths` are a hint and may
 * name a directory, and a card that landed inside it between the review and the merge is not
 * evidence about this one. That is why the false positive is staged here, through `proof.ts` and
 * `lib/git/read.ts`, rather than as a fabricated chain in the pure rule's suite.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Card } from "../../lib/board/card.ts";
import { landingGate } from "../../lib/board/contract.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { LEAD, NOW, written } from "../../test/helpers/fixtures/board-rules.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { landedChain } from "./proof.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const ID = "4";

/** One git call, failing loudly: a setup step that did not happen is a case that lies. */
async function git(args: string[], cwd: string): Promise<string> {
	const result = await execP("git", args, { cwd });
	if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

/** A host whose git calls are real, so the board reads the repository a case built. */
function host() {
	return createFakePi({ exec: (command, args, options) => execP(command, args, options) }).pi;
}

/** Write `body` at `rel` in `repo` and commit it, answering the commit. */
async function commitFile(repo: string, rel: string, body: string, message: string): Promise<string> {
	const path = join(repo, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
	await git(["add", rel], repo);
	await git(["commit", "-qm", message], repo);
	return await git(["rev-parse", "HEAD"], repo);
}

/** A card signed at `sha`, with the path hints the case gives it. */
function signedAt(sha: string, paths: readonly string[]): Card {
	return {
		...written(),
		paths: [...paths],
		review: {
			by: LEAD.label,
			at: NOW,
			verified: { cmd: "bun run check", exit: 0, at: NOW, root: "/repo", branch: "work", sha },
		},
	};
}

/** The store `landedChain` reads: the card, and the checkout its git calls run in. */
function storeOf(card: Card, repo: string) {
	return { read: async () => card, root: () => repo };
}

/**
 * The #557 shape: a branch adds `dir/own.ts` and is reviewed there, `main` gains a neighbour's
 * file inside the same directory, and the branch lands with a clean `--no-ff` merge.
 */
async function withNeighbour(): Promise<{ repo: string; reviewed: string }> {
	const repo = temps.track(await makeRepo("pi-landing-"));
	await git(["checkout", "-q", "-b", "work"], repo);
	const reviewed = await commitFile(repo, "dir/own.ts", "export const own = 1;\n", "add own");
	await git(["checkout", "-q", "main"], repo);
	await commitFile(repo, "dir/neighbour.ts", "export const neighbour = 1;\n", "neighbour lands");
	await git(["merge", "--no-ff", "-qm", "merge work", "work"], repo);
	return { repo, reviewed };
}

/**
 * The true positive: `main` edited the line the branch edited, so the merge has to resolve it,
 * and the tree that lands is one nobody ran the gate on.
 */
async function withResolution(): Promise<{ repo: string; reviewed: string }> {
	const repo = temps.track(await makeRepo("pi-landing-resolution-"));
	await git(["checkout", "-q", "-b", "work"], repo);
	const reviewed = await commitFile(repo, "dir/own.ts", "one\ntwo\n", "own work");
	await git(["checkout", "-q", "main"], repo);
	await commitFile(repo, "dir/own.ts", "one\nthree\n", "neighbour edits the same line");
	await commitFile(repo, "dir/neighbour.ts", "neighbour\n", "neighbour file");
	const conflicted = await execP("git", ["merge", "--no-ff", "-m", "merge work", "work"], { cwd: repo });
	expect(conflicted.code, "the merge was meant to conflict").not.toBe(0);
	writeFileSync(join(repo, "dir", "own.ts"), "one\nresolved\n");
	await git(["add", "dir/own.ts"], repo);
	await git(["commit", "-qm", "merge work"], repo);
	return { repo, reviewed };
}

describe("the landing a close resolves", () => {
	test("accepts a clean merge when a neighbour landed in the card's directory hint", async () => {
		const { repo, reviewed } = await withNeighbour();
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, host());
		// The merge's tree holds the neighbour's file, but the review never touched it: the diff
		// the gate compares is the review's own work, so nothing moved.
		expect(proof?.moved).toBeUndefined();
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});

	test("accepts the same merge for a card that names no paths", async () => {
		const { repo, reviewed } = await withNeighbour();
		const proof = await landedChain(storeOf(signedAt(reviewed, []), repo), ID, host());
		// A card with no hints used to compare the whole tree, so any neighbour refused it.
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});

	test("refuses a merge that resolved a file the review changed", async () => {
		const { repo, reviewed } = await withResolution();
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, host());
		expect(proof?.moved).toEqual(["dir/own.ts"]);
		const refusal = landingGate(ID, reviewed, proof);
		expect(refusal).toContain("dir/own.ts");
		// The neighbour's own file is not this card's problem, even in the refusal.
		expect(refusal).not.toContain("dir/neighbour.ts");
	});

	test("refuses the close when the diff behind it cannot be read", async () => {
		for (const subcommand of ["merge-base", "diff"]) {
			const { repo, reviewed } = await withNeighbour();
			const failing = createFakePi({
				exec: async (command, args, options) =>
					args[0] === subcommand ? { stdout: "", stderr: "boom", code: 128 } : await execP(command, args, options),
			}).pi;
			const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, failing);
			// Not "nothing moved": an unread diff is refused like an unread branch, because the one
			// thing this gate exists to stop is closing a merge nobody checked.
			expect(proof, subcommand).toBeUndefined();
			expect(landingGate(ID, reviewed, proof), subcommand).toContain("was not read");
		}
	});
});
