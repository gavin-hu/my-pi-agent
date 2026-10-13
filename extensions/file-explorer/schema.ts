/**
 * Parameter schema, output schema, and result type for `open_path`.
 */

import { Type, type Static } from "typebox";

/** The tool's registered name, shared by the definition and the naming guard. */
export const TOOL_NAME = "open_path";

/** Upper bound on a target path, matching the other path-taking tools. */
const MAX_PATH_LENGTH = 4096;

export const OpenPathParams = Type.Object({
	path: Type.String({
		minLength: 1,
		maxLength: MAX_PATH_LENGTH,
		description: "Path to open, relative to the working directory or absolute (a leading @ is ignored).",
	}),
	reveal: Type.Optional(
		Type.Boolean({ description: "Reveal in the file manager instead of opening in the default app." }),
	),
});

export type OpenPathArgs = Static<typeof OpenPathParams>;

export const OpenPathOutput = Type.Object({
	target: Type.String(),
	reveal: Type.Boolean(),
});

export type OpenPathResult = Static<typeof OpenPathOutput>;
