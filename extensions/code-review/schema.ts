/**
 * The `code_review` tool's name, parameters, and result shape.
 *
 * The four actions are one lifecycle: open a page, read what it is showing, read
 * the comments a reviewer sent, and close it. A preset, or the two sides a preset does
 * not name, are only the `open` action's, which is why the schema states them as optional.
 */

import { Type, type Static } from "typebox";
import { StringEnum } from "../../lib/tool-schema.ts";
import { MAX_BASE_LENGTH, REVIEW_PRESETS } from "./scope.ts";

/** The tool's registered name, shared by the definition and the naming guard. */
export const TOOL_NAME = "code_review";

/** The lifecycle a call takes one step of. */
export const REVIEW_ACTIONS = ["open", "status", "comments", "close"] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * The fields each action reads.
 *
 * The parameters are one flat object, so every field is published to every action at once and
 * only this table stops one reaching an action that would drop it: `scope`, `from` and `to`
 * are `open`'s, and carrying one to `status` says nothing about what the call read.
 * `lib/stray-fields.ts` words the refusal, and `tools.test.ts` holds the other direction.
 */
export const ACTION_FIELDS: Record<ReviewAction, readonly string[]> = {
	open: ["scope", "from", "to"],
	status: [],
	comments: [],
	close: [],
};

export const ReviewParams = Type.Object({
	action: StringEnum(REVIEW_ACTIONS, {
		description: "open serves a review page; status reads it; comments reads what was sent; close ends it.",
	}),
	scope: Type.Optional(
		StringEnum(REVIEW_PRESETS, {
			description: "The named comparison: change (the default), branch, last, uncommitted, staged, or worktree.",
		}),
	),
	from: Type.Optional(
		Type.String({
			maxLength: MAX_BASE_LENGTH,
			description: "The left side: a revision, `index`, or `tree`; omit for the default branch.",
		}),
	),
	to: Type.Optional(
		Type.String({
			maxLength: MAX_BASE_LENGTH,
			description: "The right side: a revision, `index`, or `tree`; omit for HEAD.",
		}),
	),
});

export type ReviewArgs = Static<typeof ReviewParams>;

/** One sent comment as the tool reports it. */
export const ReviewCommentOutput = Type.Object({
	rel: Type.String(),
	line: Type.Integer(),
	endLine: Type.Optional(Type.Integer()),
	side: Type.String(),
	body: Type.String(),
});

/** The state a call answers with. */
export const ReviewOutput = Type.Object({
	open: Type.Boolean(),
	scope: Type.Optional(
		StringEnum(REVIEW_PRESETS, {
			description: "The preset that names the page's comparison; absent for a pair nobody named.",
		}),
	),
	from: Type.Optional(Type.String({ description: "The left side the page compares, as it was named." })),
	to: Type.Optional(Type.String({ description: "The right side the page compares, as it was named." })),
	label: Type.String(),
	files: Type.Integer(),
	comments: Type.Integer(),
	sent: Type.Integer(),
	reviewed: Type.Integer(),
	url: Type.Optional(Type.String()),
	problem: Type.Optional(
		Type.String({ description: "Why the page has no diff, when the snapshot it read failed; absent when it has one." }),
	),
	list: Type.Optional(Type.Array(ReviewCommentOutput)),
});

export type ReviewResult = Static<typeof ReviewOutput>;
