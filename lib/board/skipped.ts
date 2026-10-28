/**
 * The sentence for the files a board could not read.
 *
 * A skipped file is not an absent one: a board written by a newer build, or a record this
 * one cannot trust, would otherwise read as "nobody has planned anything" while the work
 * sits on disk. The tool prints this under a listing, and the page prints the same sentence
 * on the footer's hover title — one body, so the two cannot name different files for the
 * same board.
 *
 * Value-only: no I/O, no clock, no store. `Skip` is the store's own record of a refusal,
 * and it arrives already phrased for a reader (`bad JSON`, `version 3`).
 */

import { plural } from "./round-text.ts";
import type { Skip } from "./store.ts";

/** The files this build refused, named with the reason, or nothing when it read them all. */
export function skippedText(skipped: readonly Skip[]): string {
	if (skipped.length === 0) return "";
	const files = skipped.map((entry) => `${entry.file} (${entry.why})`).join(", ");
	return `${plural(skipped.length, "file")} this build cannot read: ${files}`;
}
