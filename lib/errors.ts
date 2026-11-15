/**
 * Two helpers for an unknown thrown value: what to say about it, and whether it is the
 * failure a caller was waiting for.
 *
 * Extensions report a rejected promise, a failed child process, and a parser error the
 * same way: an `Error` yields its message, and anything else is stringified. A `code` —
 * `EEXIST`, `EPERM` — is what a filesystem write branches on, and reading it off an
 * unknown value is the same boundary, so it lives here too. Kept value-only so every
 * caller has one definition.
 */

/** A user-facing message for an unknown thrown value. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Whether an unknown thrown value carries one errno code, such as `EEXIST`. */
export function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * A promise settled as its value, or the sentence its rejection is.
 *
 * The half of a refusal that must never be forgotten: a door that awaits a read can fail, and an
 * extension's door has nowhere to put a stack trace — what it has is a line for the model. Two tools
 * wrote the same `.then(known, error => messageOf(error))` and branched on the union, which is a
 * shape only one of them can get wrong; this is that shape, once. It returns the failure rather than
 * throwing it, because the answer here is always something to say, not something to escape.
 */
export async function attempt<T>(promise: Promise<T>): Promise<{ value: T } | { error: string }> {
	try {
		return { value: await promise };
	} catch (error) {
		return { error: messageOf(error) };
	}
}
