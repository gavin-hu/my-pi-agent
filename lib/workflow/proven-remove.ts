/**
 * Removing a file another writer may have replaced in the same instant.
 *
 * A read followed by an unlink is two instants: something reads a file, decides it may go, and
 * the unlink takes whatever is at the name by then. That is how a board lock's takeover frees a
 * rival's fresh lock, or how a slow release deletes the lock that replaced it — two writers, each
 * believing it removed what it looked at.
 *
 * A rename is one instant, so the file this module hands `prove` is the file that was at the name.
 *
 * What counts as proof is not the same question for every caller — a lock's token says whose file
 * it is, an mtime says whether its writer is gone — so the caller answers it. This module owns the
 * window and the restore, which are the same whoever is asking.
 */

import { randomBytes } from "node:crypto";
import { link, rename, rm } from "node:fs/promises";

/**
 * Remove the file at `path` if the copy this call took aside proves it may go.
 *
 * `prove` reads the moved file and answers for it; `true` removes it, `false` puts it back. A name
 * that was taken again meanwhile keeps its newer file — that file is why this call's own was stale
 * — and the moved copy is removed either way, so a refusal leaves nothing beside the one it kept.
 *
 * `false` is not a failure: something was there that this call did not earn, or nothing was.
 */
export async function removeIfProven(path: string, prove: (moved: string) => Promise<boolean>): Promise<boolean> {
	const moved = `${path}.gone-${process.pid}-${randomBytes(4).toString("hex")}`;
	try {
		await rename(path, moved);
	} catch {
		// It left while this call was looking, which is somebody else having removed it.
		return false;
	}
	if (await prove(moved)) {
		await rm(moved, { force: true });
		return true;
	}
	await putBack(moved, path);
	return false;
}

/**
 * Put a file this call moved aside back in place, or leave the newer file that took the name.
 *
 * A failed link is the answer, not a problem: whatever holds the name now is newer than what this
 * call moved, so that one stays and this call's own copy is removed.
 */
async function putBack(moved: string, path: string): Promise<void> {
	try {
		await link(moved, path);
	} catch {
		// The name is taken again: whatever holds it now is newer than what this call moved.
	}
	await rm(moved, { force: true });
}
