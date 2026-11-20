/**
 * Parameter schema and validation for the `memory` tool.
 *
 * Pure: no host APIs, no terminal. Invalid input throws a model-readable
 * `Error` before any state changes, so the tool can return an error result
 * carrying the unchanged notes instead of half-applying a call.
 */

import { Type, type Static } from "typebox";
import { overLimit, sanitizeLine } from "../../lib/format.ts";
import { StringEnum } from "../../lib/tool-schema.ts";
import { MEMORY_ACTIONS, MEMORY_SCOPES, type MemoryAction, type MemoryScope } from "./types.ts";

/** Maximum length of one note, in characters. */
export const MAX_ENTRY_CHARS = 500;

export const MemoryParams = Type.Object({
	action: StringEnum(MEMORY_ACTIONS, {
		description: "Add, update, forget, or merge durable notes, or list what is stored.",
	}),
	text: Type.Optional(
		Type.String({
			description:
				"The note to add, or the exact existing note to update or forget. Required for add, update, and forget; at most 500 characters when `add` writes it.",
		}),
	),
	to: Type.Optional(
		Type.String({
			maxLength: MAX_ENTRY_CHARS,
			description: "The replacement note for update. Required for update.",
		}),
	),
	first: Type.Optional(
		Type.String({
			description: "One of the two notes to merge, by its text. Required for merge.",
		}),
	),
	second: Type.Optional(
		Type.String({
			description: "The other note to merge, by its text. Required for merge.",
		}),
	),
	merged: Type.Optional(
		Type.String({
			maxLength: MAX_ENTRY_CHARS,
			description: "The single note the two become. Required for merge.",
		}),
	),
	scope: Type.Optional(
		StringEnum(MEMORY_SCOPES, {
			description:
				'Which store to change: "project" (the default) or "global". Used by add, update, forget, and merge.',
		}),
	),
});

export type MemoryArgs = Static<typeof MemoryParams>;

/** Structured result returned as `structuredContent`, mirroring `details`. */
export const MemoryResult = Type.Object({
	action: StringEnum(MEMORY_ACTIONS),
	scope: StringEnum(MEMORY_SCOPES),
	project: Type.Array(Type.String()),
	global: Type.Array(Type.String()),
	changed: Type.Boolean(),
	entry: Type.Optional(Type.String()),
	to: Type.Optional(Type.String()),
	second: Type.Optional(Type.String()),
	existing: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
});

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
	return (values as readonly string[]).includes(value);
}

/** Validate the action, throwing a model-readable error for an unknown value. */
export function normalizeAction(raw: unknown): MemoryAction {
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (isOneOf(MEMORY_ACTIONS, value)) return value;
	throw new Error(`action must be one of ${MEMORY_ACTIONS.join(", ")}.`);
}

/** Validate the scope, defaulting to `project`. */
export function normalizeScope(raw: unknown): MemoryScope {
	if (raw === undefined) return "project";
	const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (isOneOf(MEMORY_SCOPES, value)) return value;
	throw new Error(`scope must be one of ${MEMORY_SCOPES.join(", ")}.`);
}

/**
 * Sanitize and validate the text a caller names a stored note by.
 *
 * One-line, like a note: a selector is copied from what a reader sees, and the store is a file
 * a reader edits by hand, so a tab or a wrapped line still matches once `sanitizeLine` collapsed
 * it. No length cap, because a capped name cannot bound a write — it only makes a note past the
 * cap unreachable by the one string that would match it. The role decides: `text` is a note for
 * `add` and a selector for `update` and `forget` (`registerTools` picks), and `merge` names two
 * notes and writes a third.
 */
export function normalizeNoteSelector(raw: unknown, field = "text"): string {
	if (typeof raw !== "string") throw new Error(`${field} is required.`);
	const text = sanitizeLine(raw);
	if (!text) throw new Error(`${field} is required.`);
	return text;
}

/**
 * Sanitize and validate one note to a single terminal-safe line of at most `MAX_ENTRY_CHARS`.
 *
 * The note being written is the capped role; a note being named goes through
 * `normalizeNoteSelector` instead. Control characters (including ESC) become spaces and
 * whitespace runs collapse to one space, matching `goal`'s one-line rule, so a stored note can
 * never inject terminal sequences when it is injected or rendered.
 */
export function normalizeEntryText(raw: unknown, field = "text"): string {
	const text = normalizeNoteSelector(raw, field);
	if (text.length > MAX_ENTRY_CHARS) throw new Error(overLimit(field, text.length, MAX_ENTRY_CHARS));
	return text;
}
