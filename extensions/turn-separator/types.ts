/**
 * Shared types for the turn-separator extension.
 *
 * The data is stored on each custom session entry, so it stays plain and
 * serialisable; the renderer reads it back when drawing the transcript.
 */

/** Structured data stored on every separator entry. */
export interface TurnSeparatorData {
	/** 1-based index of the completed user turn this separator follows. */
	turn: number;
}

/** A separator line split into its dashes and label. */
export interface SeparatorParts {
	/** Dashes before the label. */
	left: string;
	/** The centred `turn N` label. */
	label: string;
	/** Dashes after the label. */
	right: string;
}
