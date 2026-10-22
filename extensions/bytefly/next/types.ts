/**
 * The next-steps block a settled turn can end with.
 *
 * The model writes it as the last block of its reply — a `Next:` marker and two
 * or three list items — and bytefly lifts it out at `agent_settled` so it can be
 * drawn *below* the turn rule, in the aside grammar the notice already uses. The
 * design decisions live with the code that makes them: the instruction in
 * `instruction.ts`, the strict shape match in `parse.ts`, the drawing in
 * `component.ts`.
 */

/** Custom entry type carrying a settled turn's next steps; inert, never in context. */
export const NEXT_STEPS_ENTRY_TYPE = "bytefly-next-steps";

/** What one next-steps entry stores: the items, already sanitized and clipped. */
export interface NextStepsData {
	items: string[];
}
