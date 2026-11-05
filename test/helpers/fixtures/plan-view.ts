/**
 * The two plan-review fixture bodies: one long enough to overflow a short
 * terminal, and one split into heading sections so the section jump applies.
 */

/** Sixty plain lines: over the review's body for any terminal a test names. */
export const MANY_LINES = Array.from({ length: 60 }, (_, index) => `Line ${index + 1}`).join("\n");

/** Twelve-line sections, so the review's section jump has somewhere to go. */
export const SECTIONED_PLAN = Array.from({ length: 132 }, (_, index) =>
	index % 12 === 0 ? `## Section ${index / 12}` : `line ${index}`,
).join("\n");
