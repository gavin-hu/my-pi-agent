/**
 * Cancellation is a user choice, not a failure. A dedicated error lets the
 * command and tool layers report a declined confirmation as normal feedback
 * instead of an error.
 */

/** Thrown when the user declines a prompt (outside-path entry, exit cleanup). */
export class WorktreeCancelledError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorktreeCancelledError";
	}
}

/** Whether `error` is a user cancellation rather than a real failure. */
export function isWorktreeCancelled(error: unknown): error is WorktreeCancelledError {
	return error instanceof WorktreeCancelledError;
}
