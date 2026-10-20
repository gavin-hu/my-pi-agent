/**
 * One error-to-line helper for an unknown thrown value.
 *
 * Extensions report a rejected promise, a failed child process, and a parser
 * error the same way: an `Error` yields its message, and anything else is
 * stringified. Kept value-only so every extension has one definition.
 */

/** A user-facing message for an unknown thrown value. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
