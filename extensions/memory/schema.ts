/**
 * Parameter schema and validation for the `memory` tool.
 *
 * Pure: no host APIs, no terminal. Invalid input throws a model-readable
 * `Error` before any state changes, so the tool can return an error result
 * carrying the unchanged notes instead of half-applying a call.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { sanitize, stripControlChars } from "../../lib/format.ts";
import { MEMORY_ACTIONS, MEMORY_SCOPES, type MemoryAction, type MemoryScope } from "./types.ts";

/** Maximum length of one note, in characters. */
export const MAX_ENTRY_CHARS = 500;

export const MemoryParams = Type.Object({
	action: StringEnum(MEMORY_ACTIONS, {
		description: "Add a durable note, forget an existing note, or list what is stored.",
	}),
	text: Type.Optional(
		Type.String({
			description: "The note to add, or the exact existing note to forget. Required for add and forget.",
		}),
	),
	scope: Type.Optional(
		StringEnum(MEMORY_SCOPES, {
			description: 'Which store to change: "project" (the default) or "global". Used by add and forget.',
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
 * Sanitize and validate one note to a single terminal-safe line.
 *
 * Control characters (including ESC) become spaces and whitespace runs collapse
 * to one space, matching `goal`'s one-line rule, so a stored note can never
 * inject terminal sequences when it is injected or rendered.
 */
export function normalizeEntryText(raw: unknown): string {
	if (typeof raw !== "string") throw new Error("text is required.");
	const text = sanitize(stripControlChars(raw));
	if (!text) throw new Error("text is required.");
	if (text.length > MAX_ENTRY_CHARS) throw new Error(`text is longer than ${MAX_ENTRY_CHARS} characters.`);
	return text;
}
