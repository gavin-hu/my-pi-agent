/**
 * How a plan file reaches the disk, and what it leaves behind (one job).
 *
 * Two writes, one subject: the plan itself, atomically so a crash cannot truncate
 * the artifact a review is reading, and the revision a refinement replaces, kept
 * beside it so the two can be compared. Keeping them together is deliberate — the
 * revision has to be written with the same care as the plan, and before the rename
 * that overwrites it, or the text is gone.
 *
 * A revision is a dotfile named for its plan (`.‹plan›-r001.md`): `isPlanFileName`
 * and every scan that reads the directory as an index skip it, so a revision is
 * never listed, reviewed, approved, or opened by `plan_path`.
 *
 * Value-only, as a store helper must be: the paths and the text are the caller's.
 */

import { randomBytes } from "node:crypto";
import { readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * How many replaced revisions a plan keeps, as dotfiles beside it.
 *
 * A refinement overwrites the file it replaces, because the reviewed artifact has to
 * be the executed one — so the text the reviewer read was gone the moment it was
 * refined: a comment `carryFeedback` mis-anchored could not be checked against what
 * she actually saw, and two revisions could not be diffed. Five is a chain deep
 * enough to answer "what changed since I last looked" and short enough that a plan
 * refined all afternoon does not leave fifty files in the store.
 */
const MAX_REVISIONS = 5;

/**
 * Write a plan atomically: a hidden sibling temp file, then a rename. A crash
 * or a full disk mid-write leaves the previous file intact instead of a
 * truncated plan, and the temp name is a dotfile, so neither `latest()` nor a
 * plan lookup ever mistakes it for a plan.
 */
export function writeAtomic(path: string, content: string): void {
	const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		writeFileSync(temp, content, { encoding: "utf-8", flag: "wx" });
		renameSync(temp, path);
	} catch (error) {
		try {
			unlinkSync(temp);
		} catch {
			// The temp file was never created, or the rename already moved it.
		}
		throw error;
	}
}

/** The prefix a plan's revisions share, so one chain is one `startsWith`. */
function revisionPrefix(path: string): string {
	return `.${basename(path).replace(/\.md$/i, "")}-r`;
}

/** The number a revision's name carries, so the newest is the highest. */
function revisionNumber(name: string): number {
	const digits = /-r(\d+)\.md$/i.exec(name)?.[1];
	return digits === undefined ? 0 : Number.parseInt(digits, 10);
}

/** Keep `previous` as `path`'s next revision, and drop all but the newest few. */
export function keepRevision(path: string, previous: string): string {
	const dir = dirname(path);
	const prefix = revisionPrefix(path);
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.startsWith(prefix) && revisionNumber(name) > 0);
	} catch {
		names = [];
	}
	const next = Math.max(0, ...names.map(revisionNumber)) + 1;
	const target = join(dir, `${prefix}${String(next).padStart(3, "0")}.md`);
	writeAtomic(target, previous);
	// Oldest first, so what stays is the newest chain.
	const chain = [...names, basename(target)].sort((a, b) => revisionNumber(a) - revisionNumber(b));
	for (const name of chain.slice(0, Math.max(0, chain.length - MAX_REVISIONS))) {
		try {
			unlinkSync(join(dir, name));
		} catch {
			// A revision that vanished is one fewer to prune.
		}
	}
	return target;
}
