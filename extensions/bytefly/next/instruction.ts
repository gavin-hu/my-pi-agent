/**
 * The per-turn instruction that asks the model for a next-steps block.
 *
 * It is injected as a system-prompt section (never a message or an entry), so it
 * costs no transcript and needs no dedupe: `before_agent_start` sets it, the next
 * run uses it, and nothing persists. The text is deliberately one paragraph — the
 * budget test holds its ceiling — and it states three things the renderer relies
 * on: the exact marker, the list shape, and that the block is omitted when the
 * turn finished the work.
 */

/** The system-prompt section key the instruction is written under. */
export const NEXT_STEP_SECTION = "next-steps";

/**
 * What the model is told, once per user prompt.
 *
 * Backticks around commands and paths are asked for because the transcript's
 * code role is what makes the actionable token scannable; the "do not repeat"
 * line keeps one effect in one place, since the block is its only rendering.
 */
export function nextStepInstruction(): string {
	return [
		"When a reply leaves the user a choice, end it with exactly one final block:",
		"",
		"Next:",
		"1. <one action, one line, 80 characters or fewer, naming the command or file>",
		"2. <a different action>",
		"",
		"Two or three options, most useful first, commands and paths in backticks. Do not",
		"repeat them in the prose above. Omit the block when the turn finished the work.",
	].join("\n");
}
