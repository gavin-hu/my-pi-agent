/**
 * A landing found by its subject: the case a squashing repository leaves behind.
 *
 * Split from `landing.test.ts` when the rule grew its third shape (#440): that suite holds the
 * merges, and this one holds the branch that lands with `merge --squash`, where no merge on the
 * chain carries the review and the commit's own subject is the only thing naming the card.
 *
 * Real git, like its neighbour, because the subject has to travel from `git log`'s format string to
 * the rule: a fabricated chain cannot show that the line is parsed apart from the parents.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { LEAD, NOW, written } from "../../test/helpers/fixtures/board-rules.ts";
import type { Card } from "../../lib/workflow/card.ts";
import { landingFor, landingGate } from "../../lib/workflow/landing.ts";
import { landedChain } from "./proof.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const ID = "4";

/** Write `rel` in `repo` and commit it, answering the commit. A setup step that did not happen is a
 * case that lies, so both calls are checked here rather than left to the assertion. */
async function land(repo: string, rel: string, message: string): Promise<string> {
	const path = join(repo, rel);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "export const one = 1;\n");
	const added = await execP("git", ["add", rel], { cwd: repo });
	const committed = await execP("git", ["commit", "-qm", message], { cwd: repo });
	if (added.code !== 0 || committed.code !== 0) {
		throw new Error(`git commit ${rel}: ${committed.stderr}`);
	}
	return (await execP("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
}

/** A card signed at `sha`, with no path hints and the tree the sign was taken in. */
function signedAt(sha: string, repo: string): Card {
	return {
		...written(),
		paths: [],
		review: {
			by: LEAD.label,
			at: NOW,
			verified: { cmd: "bun run check", exit: 0, at: NOW, root: repo, branch: "work", sha },
		},
	};
}

describe("a squashed landing", () => {
	test("is named by the commit whose subject ends with the card's id", async () => {
		const repo = temps.track(await makeRepo("pi-landing-squash-"));
		await land(repo, "base.ts", "chore(repo): the base");
		// The card's work lands as one squashed commit whose subject ends with its id (#440).
		const landed = await land(repo, "own.ts", "feat(board): the card's own work（#4）");
		// A later card lands on top — the sign is taken here, on the merged tree — and `main` then
		// moves again: the shape that used to be refused as an older tree, then re-signed by hand.
		const reviewed = await land(repo, "other.ts", "feat(plan): a later card（#5）");
		const proof = await landedChain(
			{ read: async () => signedAt(reviewed, repo), root: () => repo },
			ID,
			createFakePi({ exec: (command, args, options) => execP(command, args, options) }).pi,
		);
		// A squashed branch leaves no merge to carry the review, so the subject is what names the landing.
		expect(proof?.chain.filter((commit) => commit.parents.length > 1)).toEqual([]);
		expect(landingGate(ID, reviewed, proof)).toBeUndefined();
		expect(landingFor(ID, reviewed, proof, NOW)).toEqual({ sha: landed, at: NOW });
	});
});
