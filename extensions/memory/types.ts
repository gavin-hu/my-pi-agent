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
export const MEMORY_ACTIONS = ["add", "forget", "list"] as const;

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
	/** The note added or forgotten, when the call named one. */
	entry?: string;
	/** Model-readable validation message when the call was rejected. */
	error?: string;
}
