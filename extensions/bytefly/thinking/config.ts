/**
 * Tuning for bytefly's live thinking counter.
 *
 * While an assistant message streams, the counter is written into the label Pi
 * shows in place of a hidden thinking block. Edit this file to change the word
 * or how often the count advances.
 */

export const THINKING_CONFIG = {
	/** Word before the count. */
	label: "Thinking",
	/** Between the word and the count, matching Pi's default `Thinking...` ellipsis. */
	ellipsis: "…",
	/** How often the count advances, in milliseconds. */
	intervalMs: 1000,
} as const satisfies {
	label: string;
	ellipsis: string;
	intervalMs: number;
};
