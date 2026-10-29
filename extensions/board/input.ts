/**
 * A card body as `add` reads it: the four fields the tool creates a card from.
 *
 * The normalization, the order the refusals come in, and the shape handed to the store are
 * one body, so a field added to `add` cannot reach the store unnormalized. This is the
 * boundary in front of `store.create`; a refusal is the first field that cannot be one.
 */

import {
	type FieldError,
	normalizeNote,
	normalizePathHints,
	normalizePriority,
	normalizeTitle,
} from "../../lib/board/card.ts";
import type { CreateInput } from "../../lib/board/store.ts";

/** The first note, or nothing when the body carries none. */
function noteOf(raw: unknown): { text?: string } | FieldError {
	if (raw === undefined) return {};
	const parsed = normalizeNote(raw);
	if ("error" in parsed) return parsed;
	return { text: parsed.text };
}

/**
 * The card `add` creates, or the first field that cannot be one.
 *
 * The store takes an already-normalized body, so this is the boundary in front of it:
 * an absent field is its default, and a bad one is refused rather than clamped.
 */
export function createInput(body: Record<string, unknown>): { input: CreateInput } | FieldError {
	const title = normalizeTitle(body.title);
	if ("error" in title) return title;
	const paths = normalizePathHints(body.paths);
	if ("error" in paths) return paths;
	const priority = normalizePriority(body.priority);
	if ("error" in priority) return priority;
	const note = noteOf(body.note);
	if ("error" in note) return note;
	return {
		input: {
			title: title.title,
			paths: paths.paths,
			priority: priority.priority,
			...(note.text === undefined ? {} : { note: note.text }),
		},
	};
}
