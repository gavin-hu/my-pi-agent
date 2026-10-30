/**
 * Tuning for bytefly's live working line.
 *
 * While the composer's top border carries Pi's working indicator, the message is
 * written into the border beside Pi's spinner. Edit this file to change the word
 * or how often the count advances.
 */

export const WORKING_CONFIG = {
	/** The word the line leads with, after Pi's spinner. */
	working: "working",
	/** How often the count advances, in milliseconds. */
	intervalMs: 1000,
} as const satisfies {
	working: string;
	intervalMs: number;
};
