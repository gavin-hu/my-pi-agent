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
import { linkSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { hasErrorCode } from "../../lib/errors.ts";

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

/**
 * How many names a create may try before it gives up on the directory.
 *
 * A tie is one extra attempt; running out means something is systematically wrong — a name
 * rule that admits no free file, or a filesystem that cannot hold one — and the sentence is
 * better than a loop nobody can see.
 */
const MAX_CREATE_ATTEMPTS = 100;

/** Test seams for {@link createAtomic}, which exists to be raced. */
export interface CreateSeams {
	/** Runs after the text is on disk and before the first name is claimed. */
	beforeLink?: () => void;
}

/**
 * Create a new plan under `dir` and return the path it won.
 *
 * The name is *claimed*, not chosen: the finished text is written to a hidden sibling and
 * hard-linked onto the candidate, which fails with `EEXIST` rather than replacing whatever is
 * already there. Two sessions writing the same title in the same minute therefore land on two
 * files — the loser moves on to `-2`, `-3` — where probing with `lstat` and then renaming let
 * the second overwrite the first, leaving the loser's text only as a revision and its result
 * naming a path that holds somebody else's plan.
 *
 * A link, not `writeFileSync(…, { flag: "wx" })`: the text reaches its name whole, so a crash
 * mid-create leaves nothing under a plan's name for a review to open.
 */
export function createAtomic(dir: string, base: string, content: string, seams: CreateSeams = {}): string {
	const temp = join(dir, `.${base}.${randomBytes(6).toString("hex")}.tmp`);
	writeFileSync(temp, content, { encoding: "utf-8", flag: "wx" });
	try {
		for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
			const candidate = join(dir, attempt === 1 ? `${base}.md` : `${base}-${attempt}.md`);
			seams.beforeLink?.();
			try {
				linkSync(temp, candidate);
				return candidate;
			} catch (error) {
				if (hasErrorCode(error, "EEXIST")) continue;
				// Anything else — a filesystem without hard links, a full disk, a permission — would
				// otherwise surface as a bare `EPERM … link '…' -> '…'` on a plain "save the plan".
				const code = (error as { code?: string }).code ?? "unknown";
				throw new Error(
					`Could not create a plan in ${dirname(temp)} (${code}): the store claims a name by hard-linking it, which this filesystem may not allow.`,
				);
			}
		}
		throw new Error(`Could not name a new plan in ${dirname(temp)} after ${MAX_CREATE_ATTEMPTS} tries.`);
	} finally {
		try {
			unlinkSync(temp);
		} catch {
			// The link moved it onto the plan, which is the only other thing that happens to it.
		}
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
