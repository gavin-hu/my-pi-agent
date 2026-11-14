/**
 * The plan proof one card carries, for the doors that have to hand it in.
 *
 * `contract`, `move`, and now `approve` each prove a card's recorded plan before the state
 * machine sees it, so the wire-up lives here once: the id a caller was given is read through the
 * store, this repository's plan store is resolved from the session, and `artifact.ts` answers.
 * Nothing here decides *what* a plan is — that is `artifact.ts`'s one rule, and this module would
 * be a second opinion the day it grew one.
 *
 * What is handed on is the question, not the answer: the store's lock is taken after this module
 * runs, so a fact taken here would be a fact about a moment the write has left. The card read here
 * is what binds it — the rule compares the path the proof names against the card under the lock.
 *
 * The doors differ in what they know, not in what they ask. A tool call has the raw argument
 * (`"4"`, `"#4"`); a command has the id it already parsed. Both hand it in as text, and both get
 * the same answer for the same card.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ArtifactProof, planForExecute } from "../../lib/board/artifact.ts";
import { resolveLanding, type LandingProof } from "../../lib/board/contract.ts";
import type { Lane } from "../../lib/board/lanes.ts";

import { normalizeCardId } from "../../lib/board/card.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore } from "../../lib/board/store.ts";

/**
 * What `store.mutate` should be told about the plan a card records, or `undefined` when it
 * records none.
 *
 * `undefined` is not a refusal: the state machine answers that case itself, with the route a
 * reader needs, so a caller proves only what exists. An id that cannot be read proves nothing
 * either, and the operation's own "does not exist" is the better sentence. What comes back is the
 * way to ask the question, so the answer is read where the rule asks it.
 */
export async function provedPlan(
	runtime: Pick<BoardSession, "planDir">,
	cwd: string,
	store: Pick<BoardStore, "read">,
	rawCard: string | undefined,
): Promise<ArtifactProof | undefined> {
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	const card = id === undefined ? undefined : await store.read(id);
	if (card?.planPath === undefined) return undefined;
	const planDir = await runtime.planDir(cwd);
	return () => planForExecute(planDir, card);
}

/**
 * What `store.mutate` should be told about the branch a card landed on, for a move to `done`.
 *
 * The board resolves the landing rather than accepting one: the model names nothing here, so a
 * card cannot claim a merge it did not get. A handful of git calls, and only for a card whose sign
 * names a commit — a run outside a repository names none, and its card owes no landing.
 *
 * What the merge changed is the review's own change, not the card's path hints and not merely a
 * file it touched: a neighbour that landed inside a hinted directory since the fork is not this
 * review's evidence, and neither is a neighbour's bullet in a file the review also edited, so
 * `resolvedByMerge` compares the lines each side changed.
 *
 * The chain is read from the repository's checkout, not the session's tree: work is made in a
 * worktree and lands in the checkout, so the checkout is the only tree whose first-parent line is
 * the landing line. `resolveLanding` is called here for one reason — the diff it needs a sha for —
 * and then the gate calls it again under the lock with the same chain, so what is handed over is a
 * question answered once and asked twice, not a second rule.
 */
export async function landedChain(
	store: Pick<BoardStore, "read" | "root">,
	rawCard: string | undefined,
	pi: Pick<ExtensionAPI, "exec">,
): Promise<LandingProof | undefined> {
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	const card = id === undefined ? undefined : await store.read(id);
	const reviewed = card === undefined ? undefined : card.review?.verified?.sha;
	if (id === undefined || card === undefined || reviewed === undefined) return undefined;
	// The git readers and their runner load here rather than at registration: a board that never
	// closes a card pays nothing for them, and the entry's static graph stays where it was.
	const { currentBranch, firstParentChain, resolvedByMerge } = await import("../../lib/git/read.ts");
	const { createExecRunner } = await import("../../lib/git/runner.ts");
	const runGit = createExecRunner(pi);
	const root = store.root();
	const branch = (await currentBranch(runGit, root).catch(() => undefined)) ?? "main";
	const chain = await firstParentChain(runGit, root, branch);
	if (chain.length === 0) return undefined;
	const check = resolveLanding({ branch, chain }, reviewed, id);
	if ("error" in check) return { branch, chain };
	const moved = await resolvedByMerge(runGit, root, reviewed, check.sha);
	// A diff that could not be read is not "nothing moved": the proof is not handed over, so the
	// close is refused the way an unread branch is, and the sentence that already says so is used.
	if (moved === undefined) return undefined;
	return { branch, chain, ...(moved.length === 0 ? {} : { moved }) };
}

/**
 * Both proofs a move carries: the plan it is executed against, and the branch a close landed on.
 *
 * One body because the two doors ask both questions from one lazily-loaded module, and because a
 * move to `done` is the only one that needs the second: a caller that is not closing pays nothing
 * for the chain, and `commands.ts` still reaches `provedPlan` directly for the plan alone.
 */
export async function moveProofs(
	runtime: Pick<BoardSession, "planDir">,
	cwd: string,
	store: Pick<BoardStore, "read" | "root">,
	rawCard: string | undefined,
	lane: Lane | undefined,
	pi: Pick<ExtensionAPI, "exec">,
): Promise<{ artifact?: ArtifactProof; landed?: LandingProof }> {
	const artifact = await provedPlan(runtime, cwd, store, rawCard);
	const landed = lane === "done" ? await landedChain(store, rawCard, pi) : undefined;
	return { ...(artifact === undefined ? {} : { artifact }), ...(landed === undefined ? {} : { landed }) };
}
