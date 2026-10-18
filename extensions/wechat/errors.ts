/**
 * The one place an unknown thrown value becomes a user-facing line.
 *
 * Every terminal notice and tool error in the extension reports the same way, so
 * an `Error` yields its message and anything else is stringified.
 */

/** A user-facing message for an unknown thrown value. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
