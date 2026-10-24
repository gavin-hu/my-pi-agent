/**
 * Revisions for the browse live status.
 *
 * A revision is a short digest of something a page already drew — the change set
 * a frame carries, or the names a listing holds — so a client can tell "nothing
 * moved" from "paint again" without comparing the payload it was sent. A
 * collision costs one skipped repaint and is corrected by the next frame or a
 * reload, which is the trade a 12-character digest makes for a small frame.
 */

import { createHash } from "node:crypto";

/**
 * A digest of the parts, cut to 12 hex characters. The parts are joined with NUL,
 * which no filename can contain, so two different lists cannot run together into
 * the same text.
 */
function digest(parts: readonly string[]): string {
	return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

/** The change set a frame carries: its totals and paths, in a stable order. */
export interface RevisionInput {
	count: number;
	insertions: number;
	deletions: number;
	files: readonly string[];
	dirs: readonly string[];
}

/**
 * The revision of a change set. The totals are part of it, so an edit that moves
 * no path still moves the revision and the chip's `+A −D` stays honest.
 */
export function changeRevision(changes: RevisionInput): string {
	return digest([`${changes.count}:${changes.insertions}:${changes.deletions}`, ...changes.files, ...changes.dirs]);
}

/** The revision of a listing's names, independent of the order they arrived in. */
export function listingRevision(names: readonly string[]): string {
	return digest([...names].sort());
}
