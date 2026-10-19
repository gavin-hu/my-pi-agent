/**
 * Shared types for bytefly's turn separator.
 *
 * The data is stored on each custom session entry, so it stays plain and
 * serialisable; the renderer reads it back when drawing the transcript.
 */

/** Structured data stored on every separator entry. */
export interface TurnSeparatorData {
	/** 1-based index of the completed user turn this separator follows. */
	turn: number;
	/** From the run's first `agent_start` to `agent_settled`, in milliseconds. */
	durationMs?: number;
	/** Top-level tool calls the run started. */
	tools?: number;
	/** Top-level tool calls that ended in error. */
	failures?: number;
	/** Whether the run ended because the user aborted it. */
	aborted?: boolean;
}
