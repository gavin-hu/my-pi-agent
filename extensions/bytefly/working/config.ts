/**
 * Tuning for bytefly's live working timer.
 *
 * While Pi's working row is up, the counter is written into the working message
 * Pi renders beside its spinner. Edit this file to change the word or how often
 * the count advances.
 */

export const WORKING_CONFIG = {
	/** Word before the count. */
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
