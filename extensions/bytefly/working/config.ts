/**
 * Tuning for bytefly's live working line.
 *
 * While Pi's working row is up, the message is written into the row beside Pi's
 * spinner. Edit this file to change the words or how often the count advances.
 */

export const WORKING_CONFIG = {
	/** Word before the count, before the first tool starts. */
	working: "Working",
	/** Between the word and the count. */
	ellipsis: "…",
	/** How often the count advances, in milliseconds. */
	intervalMs: 1000,
} as const satisfies {
	working: string;
	ellipsis: string;
	intervalMs: number;
};
