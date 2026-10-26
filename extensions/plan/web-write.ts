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

import { claimAuthor, normalizeAuthor, stripFeedback, type PlanAnnotation } from "./feedback.ts";
import type { PlanStore, StoredPlan } from "./plans.ts";
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
	 * The stripped text the page rendered. A file whose body no longer matches is a
	 * `409`: the comments would otherwise land beside text nobody read.
	 */
	pageText(): string;
}

/** An owner's save: the plan as it was written, or why it was refused. */
export type OwnerWrite = { ok: true; plan: StoredPlan } | { ok: false; status: number; message: string };

/** Every refusal both paths share, before anyone's markers are touched. */
const GONE = { ok: false, status: 404, message: "The plan file is gone." } as const;
const MOVED = {
	ok: false,
	status: 409,
	message: "The plan changed on disk; reload the page and review again.",
} as const;

/** The file as it is now, when it still matches what the page rendered. */
async function verified(
	deps: WriteDeps,
): Promise<{ ok: true; plan: StoredPlan } | { ok: false; status: number; message: string }> {
	const current = await deps.store.read(deps.cwd, deps.path);
	if (!current) return GONE;
	if (stripFeedback(current.content) !== deps.pageText()) return MOVED;
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
		const plan = await deps.store.saveFeedback(deps.cwd, deps.path, [...annotations]);
		return { ok: true, plan };
	} catch (error) {
		return { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
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
		await deps.store.saveFeedback(deps.cwd, deps.path, own, { author: claim.name });
		return { save: { ok: true, author: claim.name }, count: own.length };
	} catch (error) {
		return {
			save: { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) },
			count: 0,
		};
	}
}
