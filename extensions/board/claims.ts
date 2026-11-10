/**
 * The bus's path claims, as a card's lane says they should be.
 *
 * A card's `paths` are hints the plan named, and the bus's claims are the one ownership the
 * board can make real (`docs/extensions/board.md` says so: "a label, not a lock — only
 * `session-bus` path claims are"). So the rule here is one sentence: **a card in `execute`
 * holds its paths, and a card anywhere else does not.** Entering `execute` claims them,
 * leaving it — or finishing, or dropping the card — releases them, and the crossing is the
 * only thing this module asks about: `MutateResult.previous` is the card the store read
 * under its lock, so a write that stays in its lane costs no bus call at all.
 *
 * Nothing here may cost a card write. A board without `session-bus` is the documented
 * single-session mode, so no bus means silence rather than a clause on every move; a bus
 * that refused is a sentence on the result, like a sign nobody heard (`announce.ts`). A
 * conflict is neither: the card is the session's and the files are another's, and the move
 * stands — refusing it would undo a legitimate write over a fact about paths.
 *
 * The claim is per session, and the bus drops a session's claims when it stops, so a resumed
 * session re-claims once (`reclaimHeld`) rather than on every turn.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef } from "../../lib/board/card.ts";
import { plural } from "../../lib/board/round-text.ts";
import type { MutateResult } from "../../lib/board/store.ts";
import { sanitizeLine } from "../../lib/format.ts";
import {
	busLoaded,
	type ClaimPathsResult,
	claimPaths,
	type ReleasePathsResult,
	releasePaths,
} from "../../lib/session-tool.ts";

/** The bus calls this module needs, as one seam a suite can answer. */
export interface Claims {
	/** Whether the `session` tool is loaded: no bus is a silent no-op, not a failure. */
	loaded(): boolean;
	claim(ctx: ExtensionContext, paths: readonly string[]): Promise<ClaimPathsResult>;
	release(ctx: ExtensionContext, paths: readonly string[]): Promise<ReleasePathsResult>;
}

/** The production seam, bound to the extension's `pi`. */
export function busClaims(pi: Pick<ExtensionAPI, "events" | "getAllTools">): Claims {
	return {
		loaded: () => busLoaded(pi),
		claim: (ctx, paths) => claimPaths(pi, ctx, paths),
		release: (ctx, paths) => releasePaths(pi, ctx, paths),
	};
}

/**
 * Make the bus's claims match the lane the write left the card in, and say so when the
 * answer is not simply "held".
 *
 * `undefined` is the ordinary answer: the write stayed in its lane, the card names no paths,
 * or nobody is listening on a bus. The one clause worth a line is a conflict — another
 * session holds a file this card names — and a bus that refused to write.
 */
export async function holdPaths(
	claims: Claims,
	ctx: ExtensionContext,
	result: MutateResult,
): Promise<string | undefined> {
	if (!result.ok || !result.changed) return undefined;
	const before = result.previous;
	if (before === undefined) return undefined;
	const after = result.card;
	const entering = !result.dropped && after.lane === "execute" && before.lane !== "execute";
	const leaving = before.lane === "execute" && (result.dropped || after.lane !== "execute");
	if (!entering && !leaving) return undefined;
	if (!claims.loaded()) return undefined;
	return entering ? await claimedClause(claims, ctx, after) : await releasedClause(claims, ctx, after);
}

/**
 * Claim the paths of the cards this session already holds in `execute`, and say what was not held.
 *
 * The first turn after a session starts is the one write this module makes without a lane
 * crossing: the bus forgets a session's claims when it stops, and a resumed session is holding
 * the same card. Best-effort by design — the first turn must not fail on a bus, and the claim
 * it repeats is idempotent — but not silent: a refusal or a conflict is one clause the injected
 * line carries, because a failure nobody hears is what made this re-claim a no-op in the first
 * place. `undefined` is every ordinary answer: no bus, no execute card with paths, or all held.
 */
export async function reclaimHeld(
	claims: Claims,
	ctx: ExtensionContext,
	held: readonly Card[],
): Promise<string | undefined> {
	if (!claims.loaded()) return undefined;
	const failed: string[] = [];
	for (const card of held) {
		if (card.lane !== "execute" || card.paths.length === 0) continue;
		const clause = reclaimClause(await claims.claim(ctx, card.paths).catch(failedClaim));
		if (clause !== undefined) failed.push(`${cardRef(card.id)}: ${clause}`);
	}
	return failed.length === 0 ? undefined : failed.join("; ");
}

/** A seam that threw, as the answer it would have given: a bus that went away is a refusal. */
function failedClaim(error: unknown): { ok: false; error: string } {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * What a re-claim answered with something other than "held": the refusal, or the paths another
 * session has. Shorter than the crossing's clause because the card id it follows is the subject.
 */
function reclaimClause(answer: ClaimPathsResult): string | undefined {
	if (!answer.ok) return `not claimed (${sanitizeLine(answer.error)})`;
	if (answer.conflicts.length === 0) return undefined;
	return `${plural(answer.conflicts.length, "path")} already held by ${holdersOf(answer.conflicts)}`;
}

/** What a claim did, as one clause: the paths it took, the ones it could not, or why not. */
async function claimedClause(claims: Claims, ctx: ExtensionContext, card: Card): Promise<string | undefined> {
	if (card.paths.length === 0) return undefined;
	const answer = await claims.claim(ctx, card.paths).catch(failedClaim);
	if (!answer.ok) return `paths not claimed (${sanitizeLine(answer.error)})`;
	if (answer.conflicts.length === 0) return `claimed ${plural(answer.claimed.length, "path")}`;
	return `${plural(answer.conflicts.length, "path")} already held by ${holdersOf(answer.conflicts)}`;
}

/**
 * What a release did: nothing worth a line on success, and the refusal when the bus said no.
 *
 * Releasing is cleanup — a peer blocked by a finished card's claim is the failure, not the
 * absence of a confirmation.
 */
async function releasedClause(claims: Claims, ctx: ExtensionContext, card: Card): Promise<string | undefined> {
	if (card.paths.length === 0) return undefined;
	const answer = await claims.release(ctx, card.paths).catch(failedClaim);
	return answer.ok ? undefined : `paths not released (${sanitizeLine(answer.error)})`;
}

/** The sessions holding a conflict, each named once, in the order the bus listed them. */
function holdersOf(conflicts: readonly { ownerLabel: string }[]): string {
	const seen: string[] = [];
	for (const conflict of conflicts) {
		const label = sanitizeLine(conflict.ownerLabel);
		if (!seen.includes(label)) seen.push(label);
	}
	return seen.join(", ");
}
