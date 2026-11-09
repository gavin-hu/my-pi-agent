/**
 * The plan proof one card carries, for the doors that have to hand it in.
 *
 * `contract`, `move`, and now `approve` each prove a card's recorded plan before the state
 * machine sees it, so the wire-up lives here once: the id a caller was given is read through the
 * store, this repository's plan store is resolved from the session, and `artifact.ts` answers.
 * Nothing here decides *what* a plan is — that is `artifact.ts`'s one rule, and this module would
 * be a second opinion the day it grew one.
 *
 * The doors differ in what they know, not in what they ask. A tool call has the raw argument
 * (`"4"`, `"#4"`); a command has the id it already parsed. Both hand it in as text, and both get
 * the same answer for the same card.
 */

import { type ArtifactCheck, planForExecute } from "../../lib/board/artifact.ts";
import { normalizeCardId } from "../../lib/board/card.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import type { BoardStore } from "../../lib/board/store.ts";

/**
 * What `store.mutate` should be told about the plan a card records, or `undefined` when it
 * records none.
 *
 * `undefined` is not a refusal: the state machine answers that case itself, with the route a
 * reader needs, so a caller proves only what exists. An id that cannot be read proves nothing
 * either, and the operation's own "does not exist" is the better sentence.
 */
export async function provedPlan(
	runtime: Pick<BoardSession, "planDir">,
	cwd: string,
	store: Pick<BoardStore, "read">,
	rawCard: string | undefined,
): Promise<ArtifactCheck | undefined> {
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	const card = id === undefined ? undefined : await store.read(id);
	if (card?.planPath === undefined) return undefined;
	return planForExecute(await runtime.planDir(cwd), card);
}
