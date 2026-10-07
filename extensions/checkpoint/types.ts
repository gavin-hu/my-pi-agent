/**
 * Shared types for the checkpoint extension.
 *
 * A checkpoint is a git commit object that captures the working tree (tracked
 * files plus, by default, untracked non-ignored files) at the start of a task.
 * It is kept alive by a ref under `refs/pi/checkpoints/<id>`, and its metadata
 * is stored as JSON in the commit body, so checkpoints survive across sessions
 * and worktrees without any external index file.
 */

/** Why a checkpoint was created. */
export type CheckpointReason = "auto" | "manual" | "pre-restore";

/** A stored task checkpoint. */
export interface Checkpoint {
	/** Short id; also the final path segment of {@link ref}. */
	id: string;
	/** Full ref name, e.g. `refs/pi/checkpoints/c-abc123`. */
	ref: string;
	/** Commit the ref points at. */
	commit: string;
	reason: CheckpointReason;
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

/** Structured result carried in the `save` tool's `details`. */
export interface CheckpointDetails {
	/** The snapshot that was created. */
	checkpoint?: Checkpoint;
	/** Model-readable failure message when the call was rejected. */
	error?: string;
}
