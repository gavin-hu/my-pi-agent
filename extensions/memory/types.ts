/**
 * Shared types for the memory extension.
 *
 * Memory is kept outside the session branch as human-editable markdown, so it
 * survives `/new`, `/resume`, and `/tree`. A note is one bullet line, scoped
 * `global` (every project) or `project` (the current repository).
 */

export const MEMORY_SCOPES = ["project", "global"] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** What a call did, used by the result schema, details, and transcript renderer. */
export const MEMORY_ACTIONS = ["add", "update", "forget", "merge", "list"] as const;

/**
 * One note: what it says, and who asserted it and when.
 *
 * The **text** is the note's identity — `forget` and `update` match it, duplicates compare
 * it, the picker edits it — so the trailer on disk is metadata and never part of a match.
 */
export interface MemoryNote {
	text: string;
	/** The session label that wrote it; absent for a note from before attribution, or by hand. */
	by?: string;
	/** When it was written, ISO-8601; absent with `by`. */
	at?: string;
}

/** What a write knows about the session making it. */
export interface NoteStamp {
	by?: string;
	at?: string;
}

/** `[jack] the note`, or the bare text for one nobody is named on. */
export function noteLabel(note: MemoryNote): string {
	return note.by === undefined ? note.text : `[${note.by}] ${note.text}`;
}

export type MemoryAction = (typeof MEMORY_ACTIONS)[number];

/** Custom-message type for the hidden injected memory context. */
export const MEMORY_CONTEXT_TYPE = "memory-context";

/** Structured result carried in the tool's `details` and `structuredContent`. */
export interface MemoryDetails {
	action: MemoryAction;
	/** The scope the call targeted. */
	scope: MemoryScope;
	/** Notes after the call; empty for `project` when the project is untrusted. */
	project: string[];
	global: string[];
	changed: boolean;
	/** The note added, forgotten, or replaced (the previous text, for `update`). */
	entry?: string;
	/** The replacement note, for `update`; the note the pair became, for `merge`. */
	to?: string;
	/** The second note a `merge` folded away, for the details. */
	second?: string;
	/** The stored note an `add` matched as a duplicate, when it did. */
	existing?: string;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}

/**
 * The fields each action reads.
 *
 * The parameters are one flat object, so every field is published to every action at once and
 * only this table stops one reaching an action that would drop it. `scope` is here for all five
 * because `list` is scoped too — it is the store the listing reads, not only the one a write
 * touches. `lib/stray-fields.ts` words the refusal, and `tools.test.ts` holds the other
 * direction so a published field cannot go unclaimed.
 */
export const ACTION_FIELDS: Record<MemoryAction, readonly string[]> = {
	add: ["scope", "text"],
	update: ["scope", "text", "to"],
	forget: ["scope", "text"],
	merge: ["scope", "first", "second", "merged"],
	list: ["scope"],
};
