/**
 * Shared types for the rewind extension.
 *
 * A snapshot is a git commit object that captures the working tree (tracked
 * files plus, by default, untracked non-ignored files) at the start of a task.
 * It is kept alive by a ref under `refs/pi/rewind/<id>`, and its metadata is
 * stored as JSON in the commit body, so snapshots survive across sessions and
 * worktrees without any external index file.
 *
 * Each snapshot also records the conversation entry it precedes, so `/rewind`
 * can pair a working-tree restore with moving the session tree back to that
 * prompt.
 */

/** Why a snapshot was created. */
export type SnapshotReason = "auto" | "manual" | "pre-restore";

/** A stored task snapshot. */
export interface Snapshot {
	/** Short id; also the final path segment of {@link ref}. */
	id: string;
	/** Full ref name, e.g. `refs/pi/rewind/c-abc123`. */
	ref: string;
	/** Commit the ref points at. */
	commit: string;
	reason: SnapshotReason;
	/** User-supplied label from a manual save. */
	label?: string;
	/** Short summary of the user prompt that started the task, for display. */
	prompt?: string;
	/** Creation time, epoch milliseconds. */
	timestamp: number;
	/** Absolute repository (or worktree) root the snapshot was taken from. */
	root: string;
	/** Branch checked out at creation, or undefined when detached. */
	branch?: string;
	/** Commit HEAD pointed at when the snapshot was taken. */
	head: string;
	/** True when the working tree was clean and the ref reuses HEAD. */
	clean: boolean;
	/** Whether untracked, non-ignored files were included. */
	includeUntracked: boolean;
	/** Pi session the snapshot was taken in. */
	sessionId: string;
	/** User-message entry this snapshot precedes, or null outside a prompt. */
	entryId: string | null;
}

/** What a restore did. */
export interface RestoreSummary {
	id: string;
	commit: string;
	root: string;
	/** Files rewritten from the snapshot (modified plus restored deletions). */
	changed: number;
	/** Files deleted because they were created after the snapshot. */
	removed: number;
	/** Id of the pre-restore safety snapshot, when one was taken. */
	safety?: string;
}
