/**
 * Parameter schema and validation for the `checkpoint` tool.
 *
 * Pure: no host APIs, no terminal. Invalid input throws a model-readable
 * `Error` before any git command runs, so a bad id cannot be turned into a ref
 * name or a pathspec.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { CHECKPOINT_ACTIONS, type CheckpointAction } from "./types.ts";

/** Longest accepted label. */
export const MAX_LABEL = 120;
/** A checkpoint id is also a ref path segment, so it stays to a safe alphabet. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CheckpointActionEnum = StringEnum(CHECKPOINT_ACTIONS, {
	description: "What to do: save a snapshot, list them, diff one, restore one, or clear them.",
});

export const CheckpointParams = Type.Object({
	action: CheckpointActionEnum,
	label: Type.Optional(
		Type.String({ description: `Label for a saved snapshot (at most ${MAX_LABEL} characters).` }),
	),
	id: Type.Optional(
		Type.String({ description: 'Checkpoint id for `diff` or `restore`. Defaults to the newest ("last").' }),
	),
	all: Type.Optional(
		Type.Boolean({ description: "For `list`/`clear`, include checkpoints from every worktree, not just this one." }),
	),
});

export type CheckpointArgs = Static<typeof CheckpointParams>;

/** A validated tool call. */
export interface NormalizedCall {
	action: CheckpointAction;
	label?: string;
	id?: string;
	all: boolean;
}

function normalizeLabel(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const label = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	if (!label) return undefined;
	if (label.length > MAX_LABEL) throw new Error(`label is longer than ${MAX_LABEL} characters.`);
	return label;
}

function normalizeId(raw: unknown, action: CheckpointAction): string | undefined {
	if (raw === undefined || raw === null || raw === "") {
		// `diff` and `restore` default to the newest checkpoint.
		return action === "diff" || action === "restore" ? "last" : undefined;
	}
	if (typeof raw !== "string" || !ID_PATTERN.test(raw)) {
		throw new Error("id must match [A-Za-z0-9][A-Za-z0-9._-]*.");
	}
	return raw;
}

/** Validate and normalize the model's arguments. Throws a model-readable error. */
export function normalizeCall(raw: unknown): NormalizedCall {
	const args = (raw ?? {}) as Partial<CheckpointArgs>;
	const action = args.action as CheckpointAction;
	if (!(CHECKPOINT_ACTIONS as readonly string[]).includes(action)) {
		throw new Error(`action must be one of ${CHECKPOINT_ACTIONS.join(", ")}.`);
	}
	const label = action === "save" ? normalizeLabel(args.label) : undefined;
	return { action, label, id: normalizeId(args.id, action), all: args.all === true };
}
