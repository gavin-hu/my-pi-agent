/**
 * What the review's view switch says about the plan it is showing.
 *
 * One sentence per (view, why nothing): a filtered plan that reads as a short one is the
 * defect the count exists for, and the two ways a view can have no prose of its own want
 * different words — "nothing changed" sat over a heading that visibly did, which is how
 * `empty` came to carry a reason rather than a flag.
 *
 * `viewNotes` returns the table, so the sentence set crosses into the client bundle as one
 * function body; its return type is the completeness guard, and a third view added to
 * `ReviewView` fails to compile until it has a row here.
 */

import { pageSource } from "../../lib/format.ts";
import type { ReviewEmpty, ReviewView, ViewCounts } from "./web-blocks.ts";

/** The view that has a note, which is every view but the whole plan. */
type FilteredView = Exclude<ReviewView, "all">;

/** The sentences: one per view, and one per reason it has no prose of its own to show. */
export function viewNotes(): Record<FilteredView, Record<ReviewEmpty, string>> {
	return {
		changed: {
			nothing: "Nothing changed since the last review",
			headings: "Only headings changed since the last review",
		},
		comments: {
			nothing: "No comments on this plan yet",
			headings: "The only comments are on headings",
		},
	};
}

/** The same table, for a case that reads a sentence without a document. */
export const VIEW_NOTES = viewNotes();

/**
 * The line under the switch: what the view hid, or which nothing it found.
 *
 * `all` says nothing, because it is hiding nothing. A settled review says nothing either,
 * and that is the caller's to decide: the header already carries how it ended.
 */
export function reviewNote(view: ReviewView, counts: ViewCounts): string {
	if (view === "all") return "";
	if (counts.empty !== undefined) return viewNotes()[view][counts.empty];
	return "Showing " + counts.shown + " of " + (counts.shown + counts.hidden) + " blocks — " + counts.hidden + " hidden";
}

/**
 * Why the switch cannot offer the Changed view: the plan has no baseline to compare against.
 *
 * A function, not a constant, because it crosses into the client bundle the way the sentences
 * above do. It is not one of them: those answer what a view shows, and this answers a control
 * that is off — the note line prints it, and the switch's group describes itself with it, so a
 * reader who cannot reach a disabled button still hears why it is disabled.
 */
export function changedUnavailable(): string {
	return "No earlier review of this plan to compare against";
}

/** The sentences and the rule that picks one, for the client bundle. */
export const WEB_NOTE_JS = [viewNotes, reviewNote, changedUnavailable].map(pageSource).join("\n\n");
