/**
 * Error-text extraction shared by the memory tool and the `/memory` command, so
 * both report an unknown thrown value the same way.
 */

/** A human-readable message for an unknown thrown value. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
