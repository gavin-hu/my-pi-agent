/**
 * Parameter schema and validation for the `checkpoint` save tool.
 *
 * Pure: no host APIs, no terminal. The only model action is `save`, so a bad
 * label is rejected with a model-readable `Error` before any git command runs.
 */

import { Type, type Static } from "typebox";

/** Longest accepted label. */
export const MAX_LABEL = 120;

export const CheckpointParams = Type.Object({
	label: Type.Optional(
		Type.String({ description: `Label for the saved checkpoint (at most ${MAX_LABEL} characters).` }),
	),
});

export type CheckpointArgs = Static<typeof CheckpointParams>;

function normalizeLabel(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const label = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	if (!label) return undefined;
	if (label.length > MAX_LABEL) throw new Error(`label is longer than ${MAX_LABEL} characters.`);
	return label;
}

/** Validate and normalize the model's arguments. Throws a model-readable error. */
export function normalizeSave(raw: unknown): { label?: string } {
	const args = (raw ?? {}) as Partial<CheckpointArgs>;
	return { label: normalizeLabel(args.label) };
}
