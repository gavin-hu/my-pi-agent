/**
 * Shared types for the checkpoint extension.
 *
 * A checkpoint is a git commit object that captures the working tree (tracked
 * files plus, by default, untracked non-ignored files). It is kept alive by a
 * ref under `refs/pi/checkpoints/<id>`, and its metadata is stored as JSON in
 * the commit body, so checkpoints survive across sessions and worktrees without
 * any external index file.
 */

/** When automatic snapshots are taken. */
export const CHECKPOINT_MODES = ["turn", "call", "off"] as const;
export type CheckpointMode = (typeof CHECKPOINT_MODES)[number];

/** Actions the `checkpoint` tool accepts. */
export const CHECKPOINT_ACTIONS = ["save", "list", "diff", "restore", "clear"] as const;
export type CheckpointAction = (typeof CHECKPOINT_ACTIONS)[number];

/** Why a checkpoint was created. */
export type CheckpointReason = "auto" | "manual" | "pre-restore";

/** A stored snapshot. */
export interface Checkpoint {
	/** Short id; also the final path segment of {@link ref}. */
	id: string;
	/** Full ref name, e.g. `refs/pi/checkpoints/c-abc123`. */
	ref: string;
	/** Commit the ref points at. */
	commit: string;
	/** Tree the commit records. */
	tree: string;
	reason: CheckpointReason;
	/** User-supplied label from a manual save. */
	label?: string;
	/** Tool that triggered an automatic checkpoint. */
	tool?: string;
	/** Turn index at creation, when known. */
	turn?: number;
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
	/** Id of the pre-restore safety checkpoint, when one was taken. */
	safety?: string;
}

/** Structured result carried in the tool's `details`. */
export interface CheckpointDetails {
	action: CheckpointAction;
	/** Present after `list`. */
	checkpoints?: Checkpoint[];
	/** Present after `save` and `restore` (the snapshot used). */
	checkpoint?: Checkpoint;
	/** Present after `restore`. */
	restored?: RestoreSummary;
	/** Present after `diff`. */
	diff?: string;
	/**
	 * Present after `clear`: how many refs were removed. `0` means there was
	 * nothing to clear; `undefined` means the user cancelled.
	 */
	cleared?: number;
	/** Model-readable failure message when the call was rejected. */
	error?: string;
}
