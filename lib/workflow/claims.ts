/**
 * The bus's path claims, as a card's lane says they should be.
 *
 * A card's `paths` are hints the plan named, and the bus's claims are the one ownership the
 * board can make real (`docs/extensions/board.md` says so: "a label, not a lock — only
 * `session-bus` path claims are"). So the rule here is one sentence: **a card in `execute`
 * holds its paths, and a card anywhere else does not.** Entering `execute` claims them,
 * leaving it — or finishing, or dropping the card — releases them, and an edit that changes
 * them inside `execute` claims the added ones and releases the removed ones, because the
 * claims have to follow the paths rather than the lane alone. `MutateResult.previous` is the
 * card the store read under its lock, so a write that changes neither lane nor paths costs no
 * bus call at all.
 *
 * Nothing here may cost a card write. A board without `session-bus` is the documented
 * single-session mode, so no bus means silence rather than a clause on every move; a bus
 * that refused is a sentence on the result, like a sign nobody heard (`announce.ts`). A
 * conflict is neither: the card is the session's and the files are another's, and the move
 * stands — refusing it would undo a legitimate write over a fact about paths.
 *
 * The claim is per session, and the bus drops a session's claims when it stops, so a resumed
 * session re-claims once (`reclaimHeld`) rather than on every turn.
 *
 * A release frees the writer's claims and nobody else's — `releasePaths` names a session — so a
 * card taken out of `execute` by another one keeps the holder's claims until that holder stops.
 * The clause names them rather than saying nothing, because the new owner's next claim is refused
 * over exactly those paths and only the old holder can free them.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Card, cardRef } from "./card.ts";
import type { MutateResult } from "./store.ts";
import { plural, sanitizeLine } from "../format.ts";
import { sameLabel } from "../session-label.ts";
import {
	busLoaded,
	type ClaimConflict,
	type ClaimPathsResult,
	claimPaths,
	type ReleasePathsResult,
	releasePaths,
} from "../session-tool.ts";

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
	// An edit inside `execute` changes what the card holds without crossing a lane: the comparison is
	// the paths themselves, because a claim that stayed behind a removed hint blocks a peer on a file
	// the card no longer names.
	const editing = !entering && !leaving && !result.dropped && after.lane === "execute" && !samePaths(before, after);
	if (!entering && !leaving && !editing) return undefined;
	if (!claims.loaded()) return undefined;
	if (entering) return await claimedClause(claims, ctx, after);
	if (leaving) return await releasedClause(claims, ctx, result);
	return await editedClause(claims, ctx, before.paths, after.paths);
}

/** Whether two cards name the same paths, in any order: an edit that reorders holds nothing new. */
function samePaths(before: Card, after: Card): boolean {
	const sorted = (card: Card): string => [...card.paths].sort().join("\u0000");
	return sorted(before) === sorted(after);
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
		const clause = reclaimClause(await claimWhatWeCan(claims, ctx, card.paths));
		if (clause !== undefined) failed.push(`${cardRef(card.id)}: ${clause}`);
	}
	return failed.length === 0 ? undefined : failed.join("; ");
}

/** What the two-ask crossing took, and what a peer held. */
interface TakenPaths {
	/** The paths this session now holds, which may be fewer than the card names. */
	claimed: string[];
	/** The card's paths a peer holds, from either ask, each named once. */
	conflicts: ClaimConflict[];
	/** Set when a batch was refused outright: the door words it, because the bus is not there. */
	error?: string;
}

/**
 * Claim what nobody holds: the batch as it stands, then — only when conflicts came back — the rest.
 *
 * A batch is all-or-nothing at the bus, and this asks a second time rather than loosening that: one
 * peer-held path used to void the whole crossing, so a card entered `execute` holding nothing while
 * its row read `execute` and named its paths. The second batch can be refused too, by a peer that
 * took a free path in the window between the two asks, so the answer keeps the union of what was
 * refused and never counts a path the later batch refused as claimed. A clean list still costs one
 * call, and the free set is exact because a conflict names the path the card asked for.
 */
async function claimWhatWeCan(claims: Claims, ctx: ExtensionContext, paths: readonly string[]): Promise<TakenPaths> {
	const first = await claims.claim(ctx, paths).catch(failedClaim);
	if (!first.ok) return { claimed: [], conflicts: [], error: first.error };
	if (first.conflicts.length === 0) return { claimed: first.claimed, conflicts: [] };
	const held = new Set(first.conflicts.map((conflict) => conflict.path));
	const free = paths.filter((path) => !held.has(path));
	if (free.length === 0) return { claimed: [], conflicts: first.conflicts };
	const second = await claims.claim(ctx, free).catch(failedClaim);
	if (!second.ok) return { claimed: [], conflicts: first.conflicts, error: second.error };
	return { claimed: second.claimed, conflicts: [...first.conflicts, ...second.conflicts] };
}

/**
 * What two asks said, in one clause: what the crossing took, and what a peer held.
 *
 * A clean batch answers only the first half. A partial one says both, because "claimed 2 paths" alone
 * would read as the card holding every path it names. `tail` is the door's own addition — the edit,
 * whose removals must not stand beside a refused add.
 */
function tookClause(taken: TakenPaths, tail = ""): string | undefined {
	if (taken.claimed.length === 0) {
		return taken.conflicts.length === 0 ? undefined : nothingClaimed(taken.conflicts, tail);
	}
	const took = `claimed ${plural(taken.claimed.length, "path")}`;
	if (taken.conflicts.length === 0) return took;
	return `${took}, ${plural(taken.conflicts.length, "path")} already held by ${holdersOf(taken.conflicts)}${tail}`;
}

/** A seam that threw, as the answer it would have given: a bus that went away is a refusal. */
function failedClaim(error: unknown): { ok: false; error: string } {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * What a re-claim answered with something other than "held": the refusal, or the paths another
 * session has. Shorter than the crossing's clause because the card id it follows is the subject.
 */
function reclaimClause(taken: TakenPaths): string | undefined {
	if (taken.error !== undefined) return `not claimed (${sanitizeLine(taken.error)})`;
	// Silence when it all landed: the first turn after a restart is not the place for a receipt. A
	// shortfall is the one thing worth the line, and it now says what was taken beside it.
	return taken.conflicts.length === 0 ? undefined : tookClause(taken);
}

/**
 * What an edit inside `execute` did to the claims: the added paths taken, then the removed ones freed.
 *
 * The order is the all-or-nothing half. A claim that conflicts leaves the removals alone — a
 * half-applied edit would hand a peer a file the card still names, which is the one thing the claim
 * is for — so the refusal names the holders and says nothing was released. Claiming first is also
 * what keeps the card's own file set whole: the batch either took every added path or none.
 */
async function editedClause(
	claims: Claims,
	ctx: ExtensionContext,
	was: readonly string[],
	now: readonly string[],
): Promise<string | undefined> {
	const added = now.filter((path) => !was.includes(path));
	const removed = was.filter((path) => !now.includes(path));
	const said: string[] = [];
	if (added.length > 0) {
		const taken = await claimWhatWeCan(claims, ctx, added);
		if (taken.error !== undefined) return `paths not claimed (${sanitizeLine(taken.error)})`;
		// A refused added path keeps the removals: a half-applied edit would free a file the card still
		// names, so nothing is released and the clause carries both halves, the refusal last.
		if (taken.conflicts.length > 0) {
			return taken.claimed.length === 0
				? nothingClaimed(taken.conflicts, " or released")
				: tookClause(taken, ", nothing released");
		}
		said.push(`claimed ${plural(taken.claimed.length, "path")}`);
	}
	if (removed.length > 0) {
		const answer = await claims.release(ctx, removed).catch(failedClaim);
		if (!answer.ok) return `paths not released (${sanitizeLine(answer.error)})`;
		if (answer.released.length > 0) said.push(`released ${plural(answer.released.length, "path")}`);
		if (answer.notOwned.length > 0) said.push(`${plural(answer.notOwned.length, "path")} not held to release`);
	}
	return said.length === 0 ? undefined : said.join(", ");
}

/**
 * What a crossing did, as one clause: the paths it took, the ones a peer held, or why not.
 *
 * Both halves when it is partial, because a card in `execute` that named six paths and holds five is
 * a fact a reader needs on the line that moved it.
 */
async function claimedClause(claims: Claims, ctx: ExtensionContext, card: Card): Promise<string | undefined> {
	if (card.paths.length === 0) return undefined;
	const taken = await claimWhatWeCan(claims, ctx, card.paths);
	if (taken.error !== undefined) return `paths not claimed (${sanitizeLine(taken.error)})`;
	return tookClause(taken);
}

/**
 * What a release did: nothing on a clean release, and what stays held when the paths are not the
 * writer's to free.
 *
 * `releasePaths` frees the caller's own claims only, so a card taken out of `execute` by another
 * session — the lead's `reclaim`, or a `drop` — leaves the holder's claims where they were until
 * that session stops. Releasing is otherwise cleanup, and a peer blocked by a finished card's
 * claim is the failure rather than the absence of a confirmation; but the paths it could not
 * free are the reason that peer's next claim is refused, so they are the one thing worth a line.
 */
async function releasedClause(
	claims: Claims,
	ctx: ExtensionContext,
	result: Extract<MutateResult, { ok: true }>,
): Promise<string | undefined> {
	const card = result.card;
	if (card.paths.length === 0) return undefined;
	const answer = await claims.release(ctx, card.paths).catch(failedClaim);
	if (!answer.ok) return `paths not released (${sanitizeLine(answer.error)})`;
	if (answer.notOwned.length === 0) return undefined;
	const holder = result.previous?.owner;
	// A writer taking its own card back is not this: whatever it could not release is a third
	// session's, already named when the card entered. The compare is a label rather than `holds`,
	// so a peer wearing the holder's name reads as the holder and stays silent.
	if (holder === undefined || sameLabel(holder.label, card.by)) return undefined;
	const verb = answer.notOwned.length === 1 ? "stays" : "stay";
	// The duration is the fact and the action is the reader's: a lead that reads "until it stops" learns
	// the paths outlive the card but not that the holder can free them, which is the one thing it can
	// ask for (#831). `it` is the holding, so the sentence stays true for one path or many.
	return `${plural(answer.notOwned.length, "path")} ${verb} held by ${sanitizeLine(holder.label)} until it stops; only \`session release\` in that session frees it`;
}

/**
 * What a batch that took nothing says: the outcome first, because the all-or-nothing rule means no
 * path moved, and only then the paths another session holds.
 *
 * One body for the three board doors, because the conflict a claim, a re-claim and an edit each meet
 * is the same fact, and a door that named only the clashes read as partial success. The success
 * branch of each opens the same way (`claimed 3 paths`), so the pair reads as one verb with two
 * answers. `tail` is the door's own addition: an edit's claim and release fail together.
 */
function nothingClaimed(conflicts: readonly ClaimConflict[], tail = ""): string {
	return `nothing claimed${tail} — ${plural(conflicts.length, "path")} already held by ${holdersOf(conflicts)}`;
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
