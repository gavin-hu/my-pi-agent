/**
 * Parameter schema and argument building for the read-only `git` tool.
 *
 * Pure: no host APIs, no terminal. Every git argv the tool runs is assembled
 * here from a closed set of actions, never from a raw command string, so the
 * tool cannot be steered into a mutating git subcommand or an option-injection
 * payload. Revisions are validated and paths are passed after `--`.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const GIT_ACTIONS = ["status", "diff", "log", "show", "branch"] as const;

export const GitParams = Type.Object({
	action: StringEnum(GIT_ACTIONS, {
		description: "Which read-only git view to return. status/diff/log/show/branch; there is no commit, add, or push.",
	}),
	path: Type.Optional(
		Type.String({
			description: "Limit diff/log/show/status to this path or pathspec (passed after `--`).",
		}),
	),
	ref: Type.Optional(
		Type.String({
			description: "Commit, tag, branch, or range for diff/log/show. Defaults to the working tree or HEAD.",
		}),
	),
	staged: Type.Optional(Type.Boolean({ description: "diff: show staged changes (`--cached`)." })),
	stat: Type.Optional(Type.Boolean({ description: "diff/show/log: summary only (`--stat`)." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 200, description: "log: maximum commits to show (default 20)." }),
	),
});

export type GitArgs = Static<typeof GitParams>;

/** Most commits `log` returns when `limit` is omitted. */
const DEFAULT_LOG_LIMIT = 20;
/** Hard cap on `log`, regardless of the requested limit. */
const MAX_LOG_LIMIT = 200;
/** Revisions may contain these characters, but never lead with `-`. */
const SAFE_REF = /^[A-Za-z0-9_./@^~-]+$/;

function clampLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LOG_LIMIT;
	return Math.min(MAX_LOG_LIMIT, Math.max(1, Math.round(limit)));
}

/** Validate a revision so it cannot be parsed as a git option. */
function safeRef(ref: string): string {
	if (ref.startsWith("-") || !SAFE_REF.test(ref)) {
		throw new Error(`Invalid ref "${ref}": use a commit, tag, branch, or range without a leading dash.`);
	}
	return ref;
}

/**
 * Build the exact `git` argv for a tool call. Throws a model-readable `Error`
 * for an invalid ref, so the model can retry with a corrected value.
 */
export function buildGitArgs(args: GitArgs): string[] {
	const ref = args.ref?.trim();
	const path = args.path?.trim();
	const pathspec = path ? ["--", path] : [];

	switch (args.action) {
		case "status":
			return ["status", "--short", "--branch", ...pathspec];
		case "diff": {
			const argv = ["diff", "--no-color"];
			if (args.staged) argv.push("--cached");
			if (args.stat) argv.push("--stat");
			if (ref) argv.push(safeRef(ref));
			return [...argv, ...pathspec];
		}
		case "log": {
			const argv = ["log", "--oneline", "--no-color", `-n${clampLimit(args.limit)}`];
			if (args.stat) argv.push("--stat");
			if (ref) argv.push(safeRef(ref));
			return [...argv, ...pathspec];
		}
		case "show": {
			const argv = ["show", "--no-color"];
			if (args.stat) argv.push("--stat");
			argv.push(ref ? safeRef(ref) : "HEAD");
			return [...argv, ...pathspec];
		}
		case "branch":
			return ["branch", "--all", "--no-color"];
	}
}
