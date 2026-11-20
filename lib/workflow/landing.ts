/**
 * The landing rule: which merge a review became, and the door a person has when none can be named.
 *
 * Split from `contract.ts`, which is the promise and the sign: this is one reading — the chain's
 * first-parent walk, the four sentences a refusal can be, and the gate and write a `done` move asks
 * of them — and keeping it in the promise's module made that module the place every rule ended up.
 * `Landing` stays in `contract.ts` because a card records one; nothing here is imported there.
 *
 * Value-only: no I/O, no clock, no git. The chain is handed in, and `resolveLanding` answers from it.
 */

import { type Card, cardRef, holds } from "./card.ts";
import type { Landing } from "./card.ts";
import { normalizeInstruction } from "./contract.ts";
import { isLead, isPerson } from "./signs.ts";
import type { Lane } from "./lanes.ts";

/** One commit on the chain, with the parents a merge is recognised by. */
export interface LandingCommit {
	/** The commit. */
	sha: string;
	/** The committer's moment, in milliseconds — the unit every card stamp uses. */
	at: number;
	/** Its parents, in git's own order: a merge's second parent is the branch it carried. */
	parents: readonly string[];
	/**
	 * Its message's first line: a squash landing ends with the card's id (#440).
	 *
	 * Optional because the chain crosses a module boundary: `lib/git/read.ts` always writes it, but a
	 * reader loaded before the field existed keeps handing over entries without it — a `/reload` is
	 * not a restart, so a session can hold both halves. An absent subject reads as "this commit
	 * declares nothing", and a chain that cannot say what its tip declares does not get to name it.
	 */
	subject?: string;
}

/** The branch's first-parent chain, and what a landing needs to know about it. */
export interface LandingProof {
	/** The branch the chain was read from, as a sentence names it: `main`, not `refs/heads/main`. */
	branch: string;
	/** The branch's first-parent commits, oldest first. */
	chain: readonly LandingCommit[];
	/**
	 * The moment the card's work began, so a merge committed before it cannot be the landing: that is
	 * the checkout's head at the moment a reviewer signed the wrong tree.
	 */
	since: number;
	/** Whether `commit` carries the reviewed commit — asked once by the caller, never `unknown`. */
	carries(commit: LandingCommit): boolean;
	/** The review's own lines the merge rewrote; absent when none. */
	moved?: readonly string[];
}

/**
 * The merge a review became, or the sentence refusing one — with its *shape*, because which door a
 * refusal may offer depends on it, and the sentence and the rule must not disagree.
 */
export type LandingCheck = { sha: string } | { error: string; shape: LandingShape };

/** Why no merge could be named: what a refusal may offer, in the one place both read it. */
export type LandingShape = "moved" | "ancestor" | "unlanded";

/** The card as a refusal names it, spelled here so this module reads no card. */
function ref(id: string): string {
	return `#${id}`;
}

/** The sha as a refusal names it: short enough to read in a line, long enough to find. */
function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

/**
 * The card a subject declares as its own: the trailing `（#12）` / `(#12)`, whole number, leading
 * zeros allowed — and **only the trailing one**.
 *
 * A squash landing has no merge to carry it, so the subject is the only thing on the chain that says
 * which card the commit landed (#440). It is anchored to the end on purpose: a subject that merely
 * mentions another card is not that card's landing, and `#438`'s "… and corrected #436's plan (#438)"
 * is the case that proves a loose match would name one commit as two cards' landings.
 *
 * **Several ids are read as one**: a landing that also edited another card's plan carries them all,
 * `（#436、#440）` (#441), and the *last* one says which card landed. That is the same marker the
 * squashing repository's `land` writes, so the two sides read one form rather than two.
 */
function declaredCard(subject: string | undefined): string | undefined {
	// No subject is no declaration, not a fault: an entry from a reader that predates the field (#743)
	// says nothing about which card it landed, which is exactly what a subject that names nobody means.
	if (subject === undefined) return undefined;
	const number = /[（(](?:#0*\d+[、,]\s*)*#0*(?<number>\d+)[）)]\s*$/.exec(subject.trimEnd())?.groups?.number;
	return number === undefined ? undefined : String(Number(number));
}

/** Whether the subject declares this card. */
function namesCard(subject: string | undefined, id: string): boolean {
	return declaredCard(subject) === String(Number(id));
}

/**
 * The merge that carried `reviewed`, or the sentence saying why none can be named.
 *
 * A merge committed before the card's work began is never the landing: that is the checkout's head
 * at the moment a reviewer signed the wrong tree (#641). A reviewed commit is its own landing only
 * while it is the chain's *tip* — a review of the merged tree, before anything landed on top of it —
 * and the moved-lines check is skipped there rather than comparing a merge to itself. Once `main`
 * has moved past the reviewed commit, it can only be named through the merge that carries it: the
 * oldest one whose carried side contains it, which is what a re-merged branch needs (#618). A
 * reviewed commit on the chain that is carried by nothing is an older sign (#652, which is why a
 * checkout sign followed by another landing needs a re-sign); one that is nowhere is a branch
 * nobody merged. A repository that lands by **squashing** has no merge to read at all, so a subject
 * ending with the card's id names the landing instead (#440).
 */
export function resolveLanding(proof: LandingProof, reviewed: string, id: string): LandingCheck {
	const tipCommit = proof.chain.at(-1);
	const tip = tipCommit?.sha;
	const candidates = proof.chain.filter((commit) => commit.at >= proof.since);
	const tipDeclares = tipCommit === undefined ? undefined : declaredCard(tipCommit.subject);
	const tipIsForeign = tipDeclares !== undefined && tipDeclares !== String(Number(id));
	// A tip whose entry carries no subject at all cannot be told from one that declares another card —
	// the field did not travel (#743) — so it is not trusted as its own landing. Naming it would be
	// #439's misattribution, and a refusal it can act on beats a sha it cannot verify.
	const tipUnreadable = tipCommit !== undefined && tipCommit.subject === undefined;
	// The tip alone may be its own landing. A merge main has moved past carries nothing of its own
	// any more — the next merge has it as first parent — so naming it would be the base-merge bug.
	// A tip that **declares another card** is that card's squash landing, not this one's: naming it is
	// exactly the misnaming this rule exists to stop (#439 was signed on #430's landing).
	if (reviewed === tip && !tipIsForeign && !tipUnreadable && candidates.some((commit) => commit.sha === reviewed))
		return { sha: reviewed };
	for (const commit of candidates) {
		// A plain commit carries no branch of its own; only a merge has a carried side to ask about.
		if (commit.parents.length <= 1) continue;
		if (!proof.carries(commit)) continue;
		const moved = proof.moved ?? [];
		if (moved.length === 0) return { sha: commit.sha };
		return { error: movedTree(proof.branch, reviewed, commit.sha, moved, id), shape: "moved" };
	}
	const ancestor = proof.chain.some((commit) => commit.sha === reviewed);
	// A squashed landing names itself in its own subject: the branch's work is one commit whose subject
	// ends with the card's id, and the review is at or above it on the chain (#440). Asked only after
	// the tip and the merge shapes, so those two still win; newest wins among several, since a card can
	// be landed again; a review taken on an older tree falls through to the refusal below.
	const squash = candidates.filter((commit) => namesCard(commit.subject, id)).at(-1);
	if (squash !== undefined) {
		const landedAt = proof.chain.indexOf(squash);
		if (proof.chain.findIndex((commit) => commit.sha === reviewed) >= landedAt) return { sha: squash.sha };
	}
	return ancestor
		? { error: landedWithoutMerge(proof.branch, reviewed, id), shape: "ancestor" }
		: { error: absentFromBranch(proof.branch, reviewed, id), shape: "unlanded" };
}

/**
 * What `done` is refused with when the reviewed commit is not on the branch at all: the squash shape,
 * where no instruction may stand in for code.
 */
export function absentFromBranch(branch: string, reviewed: string, id: string): string {
	return `${ref(id)}'s spot-check was of \`${shortSha(reviewed)}\`, and no merge on \`${branch}\` carries it: the commit is not on the branch at all, which is what a squashed or rebased branch leaves behind. Land the work it names, then close the card — an instruction cannot stand in for a commit the branch has never seen.`;
}

/**
 * What `done` is refused with when the reviewed commit is on the branch and no merge carried it — an
 * older tree, or a commit that landed with no merge to point at. Only the second is the instruction's.
 */
export function landedWithoutMerge(branch: string, reviewed: string, id: string): string {
	return `${ref(id)}'s spot-check was of \`${shortSha(reviewed)}\`, which is on \`${branch}\` and is not the merge that carried this card: either the run was taken on an older tree, or the commit landed with no merge to point at. Sign again from the card's own commit if the tree was older; if the commit is the card's write and it landed without a merge, the lead may close the card by instruction — \`override\` with the one line saying why.`;
}

/** What `done` is refused with when the merge rewrote the review's own lines. */
export function movedTree(
	branch: string,
	reviewed: string,
	landed: string,
	moved: readonly string[],
	id: string,
): string {
	const shown = moved.slice(0, 3).join(", ");
	const rest = moved.length > 3 ? ` and ${moved.length - 3} more` : "";
	return `${ref(id)}'s spot-check was of \`${shortSha(reviewed)}\`, and the merge that carried it on \`${branch}\`, \`${shortSha(landed)}\`, moved ${shown}${rest}: the merge is what nobody ran the gate on — review the merged tree, or the lead may close the card by instruction with the reason.`;
}

/** What `done` is refused with when the door read no chain. */
export function unprovedLanding(id: string, reviewed: string): string {
	return `${ref(id)}'s spot-check was of \`${shortSha(reviewed)}\`, and the branch it landed on was not read: \`done\` resolves the merge that carried a review, and without the board's repository there is no landing — and no shape — for an instruction to stand in for.`;
}

/**
 * What a `done` move is refused with, or `undefined` when it has a landing. An `instruction` answers
 * the shapes a person's reason can stand in for — never a commit the branch has not seen, nor an
 * unread branch.
 */
export function landingGate(
	id: string,
	reviewed: string | undefined,
	proof: LandingProof | undefined,
	instruction?: string,
): string | undefined {
	if (reviewed === undefined) return undefined;
	if (proof === undefined) return unprovedLanding(id, reviewed);
	const check = resolveLanding(proof, reviewed, id);
	if (!("error" in check)) return undefined;
	const open = check.shape === "ancestor" || check.shape === "moved";
	return open && instruction !== undefined ? undefined : check.error;
}

/** The landing a `done` write records, or nothing when the sign named no commit. */
export function landingFor(
	id: string,
	reviewed: string | undefined,
	proof: LandingProof | undefined,
	now: number,
): Landing | undefined {
	if (reviewed === undefined || proof === undefined) return undefined;
	const check = resolveLanding(proof, reviewed, id);
	return "error" in check ? undefined : { sha: check.sha, at: now };
}

/**
 * The instruction a `done` move may carry, or the sentence refusing it.
 *
 * `undefined` is nobody asking for one; `{ error }` is one refused — by its own words, by a session
 * that cannot close this card, by a move that is not a close, or by a card that already names its
 * landing; `{ text }` is accepted, and the caller writes it into the card's notes because a reason is
 * prose rather than a landing. The holder is the one who knows how the work landed, so its own card
 * needs no leave-taking; the lead and the person close one the bus has lost, which `mayMove` allows.
 *
 * It lives here with the rule it answers: an instruction exists only where `landingGate` refused.
 */
export function instructionFor(options: {
	card: Card;
	raw: unknown;
	actor: { id?: string; label: string };
	lead: string;
	target: Lane;
	verdict?: LandingVerdict;
}): { error: string } | { text: string } | undefined {
	const { card, actor } = options;
	if (options.raw === undefined) return undefined;
	const asked = normalizeInstruction(options.raw);
	if ("error" in asked) return { error: asked.error };
	const allowed = holds(card, actor) || isLead(actor, options.lead) || isPerson(actor);
	if (!allowed) {
		return {
			error: `${cardRef(card.id)} is closed by instruction by the holder, the lead or the person; this session is ${actor.label}.`,
		};
	}
	if (options.target !== "done") {
		return { error: `an instruction closes a card; it has nothing to say about a move to ${options.target}.` };
	}
	if (options.verdict === undefined || !("refusal" in options.verdict)) {
		return { error: `${cardRef(card.id)} names a landing; an instruction has nothing to stand in for.` };
	}
	return { text: asked.text };
}

/**
 * What a `done` move is handed: the landing it names, or the sentence refusing one.
 *
 * The proof is a question and this is its answer, decided where the chain was read. `applyOp` applies
 * it rather than asking again, which is why `steps.ts` needs no landing module at all.
 */
export type LandingVerdict = { landing: { sha: string } } | { refusal: string };

/** The verdict for a proof the caller already read. */
export function landingVerdict(proof: LandingProof, reviewed: string, id: string): LandingVerdict {
	const check = resolveLanding(proof, reviewed, id);
	return "error" in check ? { refusal: check.error } : { landing: { sha: check.sha } };
}
