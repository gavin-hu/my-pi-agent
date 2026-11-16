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
import type { Card } from "../../lib/workflow/card.ts";
import { landingFor, landingGate, reviewedAncestor } from "../../lib/workflow/contract.ts";
import { resolvedByMerge } from "../../lib/git/read.ts";
import { createExecRunner } from "../../lib/git/runner.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { LEAD, NOW, written } from "../../test/helpers/fixtures/board-rules.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { tempDir } from "../../test/helpers/env.ts";
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

/** A card signed at `sha`, with the path hints the case gives it and the tree it was signed in. */
function signedAt(
	sha: string,
	paths: readonly string[],
	tree: { root?: string; branch?: string; checkout?: true } = {},
): Card {
	return {
		...written(),
		paths: [...paths],
		review: {
			by: LEAD.label,
			at: NOW,
			verified: {
				cmd: "bun run check",
				exit: 0,
				at: NOW,
				root: tree.root ?? "/repo",
				branch: tree.branch ?? "work",
				...(tree.checkout === undefined ? {} : { checkout: tree.checkout }),
				sha,
			},
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

/**
 * The #571 shape: both sides write into one shared file, in different sections, so the landing
 * merge is clean and the neighbour's bullet arrives through its first parent.
 */
async function withSharedFile(): Promise<{ repo: string; reviewed: string }> {
	const repo = temps.track(await makeRepo("pi-landing-shared-"));
	await commitFile(
		repo,
		"CHANGELOG.md",
		"# Clog\n\n## [Unreleased]\n\n### Added\n\n### Changed\n",
		"the changelog every card edits",
	);
	await git(["checkout", "-q", "-b", "work"], repo);
	const reviewed = await commitFile(
		repo,
		"CHANGELOG.md",
		"# Clog\n\n## [Unreleased]\n\n### Added\n\n### Changed\n\n- the review's bullet\n",
		"the review writes its bullet",
	);
	await git(["checkout", "-q", "main"], repo);
	await commitFile(
		repo,
		"CHANGELOG.md",
		"# Clog\n\n## [Unreleased]\n\n### Added\n\n- a neighbour's bullet\n\n### Changed\n",
		"a neighbour lands in the same file",
	);
	await git(["merge", "--no-ff", "-qm", "land work", "work"], repo);
	return { repo, reviewed };
}

/**
 * The true positive a range alone would pass: both sides rewrite one line, the merge resolves it,
 * and the resolution keeps the review's line count while changing its text.
 */
async function withSameRange(): Promise<{ repo: string; reviewed: string }> {
	const repo = temps.track(await makeRepo("pi-landing-range-"));
	await commitFile(repo, "dir/own.ts", "alpha\nbeta\ngamma\n", "the line both sides edit");
	await git(["checkout", "-q", "-b", "work"], repo);
	const reviewed = await commitFile(repo, "dir/own.ts", "alpha\nbeta reviewed\ngamma\n", "the review's line");
	await git(["checkout", "-q", "main"], repo);
	await commitFile(repo, "dir/own.ts", "alpha\nbeta landed\ngamma\n", "a neighbour's line");
	const conflicted = await execP("git", ["merge", "--no-ff", "-m", "merge work", "work"], { cwd: repo });
	expect(conflicted.code, "the merge was meant to conflict").not.toBe(0);
	// The same line, one indent deeper: a map of ranges would call this the review's own change.
	writeFileSync(join(repo, "dir", "own.ts"), "alpha\n  beta reviewed\ngamma\n");
	await git(["add", "dir/own.ts"], repo);
	await git(["commit", "-qm", "merge work"], repo);
	return { repo, reviewed };
}

/** The repository this suite runs in, whose history carries the landings cases below. */
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Whether a commit this suite means to read exists here: a shallow clone is not a failure. */
async function present(sha: string): Promise<boolean> {
	return (await execP("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT })).code === 0;
}

/** The landings that refused a close today: a review, and the merge that carried it. */
const REAL_LANDINGS = [
	{ reviewed: "53a14106", merged: "14ff64a3" },
	{ reviewed: "efb425e5", merged: "21c9275c" },
	{ reviewed: "fddbde30", merged: "ee910935" },
	// The landing that closed the gate's own fix: the review is this merge's second parent, and its
	// hand resolution reproduced the review's lines exactly — the shape a regression breaks first.
	{ reviewed: "6b1422fa", merged: "e6307df6" },
];

/** Whether this checkout carries all of them, read once so the cases below can skip as a group. */
const hasRealLandings = (
	await Promise.all(REAL_LANDINGS.map(async (one) => (await present(one.reviewed)) && (await present(one.merged))))
).every(Boolean);

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

	test("reads the default branch even when the checkout is on a peer branch", async () => {
		const { repo, reviewed } = await withNeighbour();
		await git(["checkout", "-q", "work"], repo);
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, host());
		// The chain is main's, not the branch the checkout happens to have: the merge that carried
		// the review, not the reviewed commit naming itself.
		expect(proof?.branch).toBe("main");
		expect(proof?.chain.some((commit) => commit.parents.slice(1).includes(reviewed))).toBe(true);
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
		await git(["checkout", "-q", "main"], repo);
	});

	test("reads the default branch from a worktree root", async () => {
		const { repo, reviewed } = await withNeighbour();
		const wt = join(temps.track(tempDir("pi-landing-wt-")), "wt");
		await git(["worktree", "add", "-q", wt, "-b", "wt"], repo);
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), wt), ID, host());
		expect(proof?.branch).toBe("main");
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});

	test("refuses a sign taken on the base a branch was cut from", async () => {
		const { repo, reviewed } = await withNeighbour();
		const base = await git(["rev-parse", `${reviewed}^`], repo);
		const proof = await landedChain(storeOf(signedAt(base, ["dir"]), repo), ID, host());
		// The reviewed commit is on main as a plain ancestor, not the merge: the sign was taken on
		// an older tree, which is #594's failure and the one the tightening must refuse.
		expect(landingGate(ID, base, proof)).toBe(reviewedAncestor("main", base, ID));
	});

	test("follows a branch merged and re-merged, so the close needs no second sign", async () => {
		const repo = temps.track(await makeRepo("pi-landing-"));
		await git(["checkout", "-q", "-b", "work"], repo);
		const reviewed = await commitFile(repo, "dir/own.ts", "export const own = 1;\n", "add own");
		await git(["checkout", "-q", "main"], repo);
		await commitFile(repo, "dir/neighbour.ts", "export const neighbour = 1;\n", "neighbour lands");
		// The branch takes main in before it lands, so the merge on `main` carries a commit whose *own*
		// second parent is the reviewed one: reading one parent deep called that an older tree (#618).
		await git(["checkout", "-q", "work"], repo);
		await git(["merge", "--no-ff", "-q", "-m", "main into work", "main"], repo);
		await git(["checkout", "-q", "main"], repo);
		await git(["merge", "--no-ff", "-q", "-m", "merge work", "work"], repo);
		const landed = await git(["rev-parse", "HEAD"], repo);
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, host());
		// The landing is the merge on main, not the reviewed commit and not the branch's own merge.
		expect(proof?.chain.at(-1)?.sha).toBe(landed);
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});

	test("accepts a checkout sign of a merge that is still the tip", async () => {
		const { repo } = await withNeighbour();
		const landed = await git(["rev-parse", "main"], repo);
		// The review of the merged tree, taken in the checkout: while `main` is still there, the merge
		// is its own landing, and a second run over the same tree would prove nothing new.
		const proof = await landedChain(
			storeOf(signedAt(landed, ["dir"], { root: repo, branch: "main", checkout: true }), repo),
			ID,
			host(),
		);
		expect(landingGate(ID, landed, proof)).toBeUndefined();
		expect(landingFor(ID, landed, proof, 7)).toEqual({ sha: landed, at: 7 });
	});

	test("refuses a checkout sign once the branch has moved past the merge it named", async () => {
		const { repo, reviewed } = await withNeighbour();
		const first = await git(["rev-parse", "main"], repo);
		// #652: the sign names the merge, and then another landing arrives before the close. The merge
		// carries nothing of its own any more, so the door is a re-sign rather than a wrong landing.
		await git(["checkout", "-q", "-b", "next"], repo);
		await commitFile(repo, "dir/next.ts", "export const next = 1;\n", "next lands");
		await git(["checkout", "-q", "main"], repo);
		await git(["merge", "--no-ff", "-q", "-m", "merge next", "next"], repo);
		const proof = await landedChain(
			storeOf(signedAt(first, ["dir"], { root: repo, branch: "main", checkout: true }), repo),
			ID,
			host(),
		);
		expect(landingGate(ID, first, proof)).toBe(reviewedAncestor("main", first, ID));
		// The branch head is still resolvable: its merge is the later one, so a worktree sign works.
		const again = await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, host());
		expect(landingGate(ID, reviewed, again)).toBeUndefined();
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

	test("names the read that could not answer, instead of refusing with no reason", async () => {
		const shapes = [
			{ subcommand: "merge-base", says: /git merge-base --is-ancestor \S+ <parent>.*answered neither yes nor no/ },
			{ subcommand: "diff", says: /the diff between \S+ and \S+.*could not be read/ },
		];
		for (const { subcommand, says } of shapes) {
			const { repo, reviewed } = await withNeighbour();
			const failing = createFakePi({
				exec: async (command, args, options) =>
					// The subcommand is matched wherever it sits: a read may carry global options first.
					args.includes(subcommand) ? { stdout: "", stderr: "boom", code: 128 } : await execP(command, args, options),
			}).pi;
			// Not "nothing moved": an unread diff is refused like an unread branch, and the sentence
			// names the command — the old one blamed a branch that had read perfectly well.
			await expect(landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, failing), subcommand).rejects.toThrow(
				says,
			);
		}
	});

	test("names the branch read that failed, with the repository and git's own words", async () => {
		// The shape that blocked a live close: a `git log` that exits non-zero answered `[]`, the same
		// as a repository with no commits, and the refusal said the branch was never read.
		const { repo, reviewed } = await withNeighbour();
		const failing = createFakePi({
			exec: async (command, args, options) =>
				args[0] === "log"
					? { stdout: "", stderr: "fatal: not a git repository", code: 128 }
					: await execP(command, args, options),
		}).pi;
		const unread = landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, failing);
		await expect(unread).rejects.toThrow(/`git log --first-parent main`/);
		await expect(unread).rejects.toThrow(/pi-landing-/);
		await expect(unread).rejects.toThrow(/fatal: not a git repository/);
	});

	test("answers nothing when the read succeeds and the branch has no commits", async () => {
		// The other half of the distinction the strict door exists for: a read that *worked* and found
		// no history is a card with nothing to land, not a failed read, so it keeps the old `undefined`
		// rather than becoming an exception.
		const { repo, reviewed } = await withNeighbour();
		const empty = createFakePi({
			exec: async (command, args, options) =>
				args[0] === "log" ? { stdout: "", stderr: "", code: 0 } : await execP(command, args, options),
		}).pi;
		expect(await landedChain(storeOf(signedAt(reviewed, ["dir"]), repo), ID, empty)).toBeUndefined();
	});

	test("accepts a clean landing when a neighbour's bullet arrives in the file the review changed", async () => {
		const { repo, reviewed } = await withSharedFile();
		const proof = await landedChain(storeOf(signedAt(reviewed, ["CHANGELOG.md"]), repo), ID, host());
		// The merge carries the neighbour's bullet in from its first parent: the merger changed
		// nothing of this review's own change, so nothing moved.
		expect(proof?.moved).toBeUndefined();
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});

	test("refuses a resolution that rewrites the review's lines with the same range", async () => {
		const { repo, reviewed } = await withSameRange();
		const proof = await landedChain(storeOf(signedAt(reviewed, ["dir/own.ts"]), repo), ID, host());
		// Same lines, different text: comparing ranges alone would pass this, which is why the
		// comparison is of the lines' content — a reindent included.
		expect(proof?.moved).toEqual(["dir/own.ts"]);
		expect(landingGate(ID, reviewed, proof)).toContain("dir/own.ts");
	});

	test("finds the merge for a card put back through the pool after it landed", async () => {
		// The reclaim shape: the work began, the branch landed, and the card was reclaimed and
		// re-entered into `execute` afterwards. Entering the lane again is continuing, not starting
		// over, so the landing sits before the card's current lane age and is still its landing.
		const { repo, reviewed } = await withNeighbour();
		const merged = Number(await git(["log", "-1", "--format=%ct", "--merges"], repo)) * 1_000;
		const card: Card = {
			...signedAt(reviewed, ["dir"]),
			lane: "execute",
			log: [
				{ lane: "backlog", by: LEAD.label, at: merged - 5_000 },
				{ lane: "plan", by: LEAD.label, at: merged - 4_000 },
				{ lane: "execute", by: LEAD.label, at: merged - 3_000 },
				{ lane: "backlog", by: LEAD.label, at: merged + 1_000 },
				{ lane: "plan", by: LEAD.label, at: merged + 2_000 },
				{ lane: "execute", by: LEAD.label, at: merged + 3_000 },
			],
		};
		const proof = await landedChain(storeOf(card, repo), ID, host());
		expect(proof, "the merge fell outside the window the card's latest lane entry set").toBeDefined();
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
	});
});

describe.skipIf(!hasRealLandings)("the landings this repository made", () => {
	for (const { reviewed, merged } of REAL_LANDINGS) {
		test(`answers nothing for ${reviewed} -> ${merged}`, async () => {
			// The reader is handed the real commits rather than a fixture, because these are the
			// landings a close was refused on: a neighbour's bullet in a shared file, and a
			// resolution that happened inside the reviewed commit.
			const moved = await resolvedByMerge(createExecRunner(host()), REPO_ROOT, reviewed, merged);
			expect(moved).toEqual([]);
		});
	}
});
