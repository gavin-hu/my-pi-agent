/**
 * The chain a landing case reads: shas, moments, and the `proof()` a case hands `resolveLanding`.
 *
 * Shared by the two suites that ask the landing rule different questions — which commit a review
 * became (`landing.test.ts`) and whether the card's own `execute` came first (`landing-order.test.ts`,
 * #475). One chain, read by both, so a fixture edit cannot make one suite disagree with the other.
 */

import type { LandingCommit, LandingProof } from "../../../lib/workflow/landing.ts";

/** The card every sentence names. */
export const ID = "12";

export const REVIEWED = "4c1f9ab0000000000000000000000000000000000";
export const CARRIED = "9a7d2e00000000000000000000000000000000000";
export const LATER = "b31c5a0000000000000000000000000000000000";
export const BASE = "0f00d00000000000000000000000000000000000";
export const PLAIN = "e0a1c0000000000000000000000000000000000";

/** The moments those commits were made at, and the moment the card's work began between two of them. */
export const DAY = 86_400_000;
export const T0 = 1_700_000_000_000;
export const BASE_AT = T0;
export const REVIEWED_AT = T0 + 2 * DAY;
export const CARRIED_AT = T0 + 3 * DAY;
export const LATER_AT = T0 + 4 * DAY;
/** The card entered `execute` after the base commit and before the merge that carried its work. */
export const SINCE = T0 + DAY;

/**
 * A chain of one base commit, the merge that carried `REVIEWED`, and a later merge on top.
 *
 * `carries` reads the fixture's own parents: a merge carries the review when its second parent is
 * it, which is the one-level answer a plain merge gives and the case a re-merge has to override.
 */
export const proof = (
	chain: readonly LandingCommit[],
	reviewed = REVIEWED,
	overrides: Partial<LandingProof> = {},
): LandingProof => ({
	branch: "main",
	chain,
	since: SINCE,
	carries: (commit) => commit.parents.slice(1).includes(reviewed),
	...overrides,
});

/** One commit of a case chain: its sha, moment, parents, and the subject the rule reads. */
export const commit = (sha: string, at: number, parents: readonly string[], subject: string): LandingCommit => ({
	sha,
	at,
	parents,
	subject,
});

export const ROOT = "0000000000000000000000000000000000000001";

export const LANE = proof([
	commit(BASE, BASE_AT, [ROOT], "chore(repo): the base the branch was cut from"),
	commit(CARRIED, CARRIED_AT, [BASE, REVIEWED], "merge(work): the review's own work"),
	commit(
		LATER,
		LATER_AT,
		[CARRIED, "7ee0d10000000000000000000000000000000000"],
		"merge(work): a later card's merge on top",
	),
]);
