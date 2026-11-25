/**
 * The work a scope change would discard, and the sentence that refuses it.
 *
 * One rule for both doors: the page answers a tab with a 409 and the session answers
 * `/review <scope>` and the tool's `open` with a notice, and two spellings of "can this
 * scope change" is how the session ended up refusing sent comments that a switch has
 * nothing to lose. Sent comments are the session's already — the notice and
 * `code_review comments` carry them — so only what a page replacement would destroy is
 * counted and named here.
 *
 * The sentence is written to be read three ways: after `review: ` in a notice, inside a
 * tool's failure text, and under the page's own title "This review has work on this
 * scope". That is why it opens on the fact rather than on a clause the title repeats.
 */

import type { Review } from "./store.ts";

/** The work a scope change would discard: comments still in draft, and files marked reviewed. */
export function scopeWork(review: Review): { drafts: number; marks: number } {
	return {
		drafts: review.comments.filter((comment) => comment.state === "draft").length,
		marks: review.reviewed.length,
	};
}

/** The sentence a scope change refuses with, naming the work it would discard and what clears it. */
export function scopeRefusal(review: Review, label: string): string {
	const { drafts, marks } = scopeWork(review);
	const has = [
		drafts > 0 ? `${drafts} draft comment${drafts === 1 ? "" : "s"}` : "",
		marks > 0 ? `${marks} file${marks === 1 ? "" : "s"} marked reviewed` : "",
	].filter((part) => part !== "");
	// Every action in the sentence is one the reviewer can take from the page itself.
	const actions = [drafts > 0 ? "send the drafts" : "", marks > 0 ? "clear the marks" : ""].filter(
		(part) => part !== "",
	);
	const action = actions.join(" and ");
	return `${has.join(" and ")} on ${label}. ${action.charAt(0).toUpperCase()}${action.slice(1)} before switching scope.`;
}
