/**
 * A chain the landing rule cannot fully read: the entries a reader loaded before `#442` hands over.
 *
 * `#442` added `subject` to the chain and the squash rule, and `landing.ts` reads it on the **tip
 * check**, before it looks at any candidate. A `lib/git/read.ts` loaded before that keeps producing
 * entries without the field — a `/reload` is not a restart, so one session can hold both halves —
 * and the close then threw `undefined is not an object` on every signed card (#743).
 *
 * The input has to be built by hand. A real repository never produces it: `read.ts` always writes the
 * field, and this repository's own chain is 1,573 entries with none missing, which is also the
 * measurement that ruled git out as the source. So a case that reached for `git log` would test the
 * parser instead of the rule — and the parser was never the broken half.
 *
 * Its own suite because `landing.test.ts` sits at the suite bar, and because this is one question:
 * what the rule does with a chain it cannot fully see. The rule's other shapes — merges, squashes,
 * several-card markers — are `landing.test.ts`'s subject.
 */

import { describe, expect, test } from "bun:test";
import { landingVerdict, landedWithoutMerge, resolveLanding, type LandingProof } from "./landing.ts";

/** The card under test, and the sha a sign names. */
const ID = "12";
const REVIEWED = "9a7d2e00000000000000000000000000000000000";
const ROOT = "0000000000000000000000000000000000000001";
const BASE = "1111111111111111111111111111111111111111";
const CARRIED = "9a7d2e00000000000000000000000000000000000";
const LATER = "b31c5a00000000000000000000000000000000000";

/** One entry as the old reader wrote it: a sha, a moment and its parents, and no subject key at all. */
interface OldEntry {
	sha: string;
	at: number;
	parents: string[];
}

const entry = (sha: string, at: number, parents: string[]): OldEntry => ({ sha, at, parents });

/** A proof over such a chain, with the carries rule the merge shape asks. */
const unknown = (chain: OldEntry[], reviewed: string): LandingProof => ({
	branch: "main",
	since: 0,
	chain,
	carries: (commit) => commit.parents.slice(1).includes(reviewed),
});

/** base ← carry(merge of the review) ← later: the merge-landed shape, read without subjects. */
const MERGED = [
	entry(BASE, 1_000, [ROOT]),
	entry(CARRIED, 2_000, [BASE, REVIEWED]),
	entry(LATER, 3_000, [CARRIED, ROOT]),
];

/** base ← squash ← a later card's squash: the shape only a subject can name. */
const SQUASH = "db80a71000000000000000000000000000000000";
const ON_TOP = "96b8d22100000000000000000000000000000000";
const SQUASHED = [entry(BASE, 1_000, [ROOT]), entry(SQUASH, 2_000, [BASE]), entry(ON_TOP, 3_000, [SQUASH])];

describe("a chain without subjects", () => {
	test("still answers the merge that carried the review", () => {
		// The direction that proves the guard disabled nothing: the merge shapes never needed a subject,
		// so a close that resolved before resolves to the same sha now.
		expect(resolveLanding(unknown(MERGED, REVIEWED), REVIEWED, ID)).toEqual({ sha: CARRIED });
	});

	test("refuses rather than throwing when the tip is the reviewed commit", () => {
		// The line that threw: the tip check read a subject that was not there. A guard that only made
		// the read total would answer the tip as its own landing — another card's sha on this one — so
		// an unreadable declaration means the tip is not trusted, and the sign is told to sign again.
		const proof = unknown(MERGED, LATER);
		expect(() => resolveLanding(proof, LATER, ID)).not.toThrow();
		expect(resolveLanding(proof, LATER, ID)).toEqual({
			error: landedWithoutMerge("main", LATER, ID),
			shape: "ancestor",
		});
	});

	test("refuses a squash landing it can no longer name, instead of naming the tip", () => {
		// #439's misattribution by the other door: with the tip's declaration unreadable, the tip
		// shortcut would record #13's landing as #12's. The squash rule cannot see #12's marker either,
		// so the close refuses — the sentence a squashed card got before #442.
		const proof = unknown(SQUASHED, ON_TOP);
		expect(resolveLanding(proof, ON_TOP, ID)).toEqual({
			error: landedWithoutMerge("main", ON_TOP, ID),
			shape: "ancestor",
		});
	});

	test("answers the board tool's own door the same way, rather than throwing out of the frame", () => {
		// `landingVerdict` is what `extensions/board/proof.ts` hands the write: a refusal there leaves
		// the card where it was, which is the outcome a close can be told about.
		expect(landingVerdict(unknown(SQUASHED, ON_TOP), ON_TOP, ID)).toEqual({
			refusal: landedWithoutMerge("main", ON_TOP, ID),
		});
		expect(landingVerdict(unknown(MERGED, REVIEWED), REVIEWED, ID)).toEqual({ landing: { sha: CARRIED } });
	});
});
