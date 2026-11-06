/**
 * The review's two write paths, over the plan store.
 *
 * An owner's save decides the review and returns to Pi; a reviewer's post only writes,
 * under the name its link has bound. Both write markers through the one codec
 * (`feedback.ts`), both refuse a file that changed under the page, and neither touches
 * another writer's markers — the store replaces exactly the writer it is handed.
 *
 * Splitting them out of `web.ts` is what leaves that module the session and its sockets:
 * every request that writes the plan comes through here, so a change to the marker
 * grammar or to the refusal wording has one file to land in.
 */

import { claimAuthor, normalizeAuthor, type PlanAnnotation } from "./feedback.ts";
import { pageRevision } from "./plan-text.ts";
import { PlanMovedError, PlanTooLargeError, type PlanStore, type StoredPlan } from "./plans.ts";
import type { ReviewCaller } from "./types.ts";
import type { SaveResult } from "./web-router.ts";

/** What a write path reads: the store, and the anchor a save is validated against. */
export interface WriteDeps {
	/** The plan store the markers are written through. */
	store: PlanStore;
	/** The directory the store resolves its paths against. */
	cwd: string;
	/** The plan's path, as the store knows it. */
	path: string;
	/**
	 * The revision the page rendered, as the island named it. The store hashes the file
	 * inside its per-plan queue and refuses a different one with `409`: the comments would
	 * otherwise land beside text nobody read, and a `steps` tick could land between a check
	 * made here and the write.
	 */
	rev: string;
}

/** An owner's save: the plan as it was written, or why it was refused. */
export type OwnerWrite = { ok: true; plan: StoredPlan } | { ok: false; status: number; message: string };

/** The file is gone: the page's plan was removed under it. */
const GONE = { ok: false, status: 404, message: "The plan file is gone." } as const;

/**
 * How one store write's refusal is answered.
 *
 * Every refusal but one is about the request: a page whose plan moved reloads and reviews
 * again (`409`), a save too large to store is the reader's (`413`), and anything else is
 * ours (`500`). The message always comes from the store, so the page says what happened
 * rather than "Internal error".
 */
function refused(error: unknown): { ok: false; status: number; message: string } {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof PlanMovedError) return { ok: false, status: 409, message };
	return { ok: false, status: error instanceof PlanTooLargeError ? 413 : 500, message };
}

/**
 * The file as it is now, when it is still the revision this page rendered.
 *
 * Asked here as well as inside the store's turn: the store's `expect` closes the window a
 * `steps` tick could use, and this answers the same question for every store — including a
 * caller's own — so the guarantee never depends on an implementation honouring it.
 */
async function verified(
	deps: WriteDeps,
): Promise<{ ok: true; plan: StoredPlan } | { ok: false; status: number; message: string }> {
	const current = await deps.store.read(deps.cwd, deps.path);
	if (!current) return GONE;
	if (pageRevision(current.content) !== deps.rev) {
		return refused(new PlanMovedError());
	}
	return { ok: true, plan: current };
}

/**
 * Save the owner's comments and report the plan they were written into.
 *
 * The caller decides what a save means (it ends the review); this path only writes, so
 * the decision and the write cannot disagree about which file was saved.
 */
export async function saveOwnerAnnotations(
	deps: WriteDeps,
	annotations: readonly PlanAnnotation[],
): Promise<OwnerWrite> {
	const check = await verified(deps);
	if (!check.ok) return check;
	try {
		// The store re-checks the same revision inside its own turn, so a `steps` tick cannot
		// land between the read above and the write below.
		const plan = await deps.store.saveFeedback(deps.cwd, deps.path, [...annotations], { expect: deps.rev });
		return { ok: true, plan };
	} catch (error) {
		return refused(error);
	}
}

/** What a reviewer's post additionally needs: who posted, and which names are taken. */
export interface ReviewerWriteDeps extends WriteDeps {
	/** The caller the link names; its `name` is the one the link has bound, if any. */
	caller: ReviewCaller;
	/** Names other live links hold, so a first post cannot claim one of them. */
	taken: readonly string[];
}

/** A reviewer's post: the name it stored under, so a page can adopt it. */
export type ReviewerWrite = { save: SaveResult; count: number };

/**
 * Write one reviewer's comments, signed and scoped to that link.
 *
 * The link, not the payload, decides whose markers this replaces: a page that signs
 * another name is a stale or foreign tab, and re-signing it would move markers that
 * belong to whoever picked that name. Only that writer's annotations are written, so a
 * post cannot disturb the owner's notes or a second reviewer's.
 */
export async function postReviewerAnnotations(
	deps: ReviewerWriteDeps,
	annotations: readonly PlanAnnotation[],
): Promise<ReviewerWrite> {
	const check = await verified(deps);
	if (!check.ok) return { save: check, count: 0 };
	const claim = claimAuthor({ bound: deps.caller.name, taken: deps.taken }, annotations);
	if (!("name" in claim)) return { save: { ok: false, status: claim.status, message: claim.message }, count: 0 };
	const own = annotations.filter((annotation) => normalizeAuthor(annotation.author) === claim.name);
	try {
		await deps.store.saveFeedback(deps.cwd, deps.path, own, { author: claim.name, expect: deps.rev });
		return { save: { ok: true, author: claim.name }, count: own.length };
	} catch (error) {
		return { save: refused(error), count: 0 };
	}
}
