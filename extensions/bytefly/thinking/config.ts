/**
 * Tuning for bytefly's live thinking counter.
 *
 * While an assistant message streams, the counter is written into two surfaces
 * Pi owns: the label that replaces a hidden thinking block, and the working row
 * shown during streaming. Both take the same word-plus-elapsed shape; edit this
 * file to change the words or how often the count advances.
 */

export const THINKING_CONFIG = {
	/** Word before the count on the hidden thinking label. */
	label: "Thinking",
	/** Word before the count on the working row. */
	working: "Working",
	/** Between the word and the count, matching Pi's default `Thinking...` ellipsis. */
	ellipsis: "…",
	/** How often the count advances, in milliseconds. */
	intervalMs: 1000,
} as const satisfies {
	label: string;
	working: string;
	ellipsis: string;
	intervalMs: number;
};
