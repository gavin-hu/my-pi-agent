/**
 * Parameter schema, output schema, and result type for `read_doc`.
 */

import { Type, type Static } from "typebox";
import type { FormatId } from "./formats.ts";

/** The tool's registered name, shared by the definition and its renderer. */
export const TOOL_NAME = "read_doc";

export const MIN_CHARS = 200;
export const MAX_CHARS = 100_000;
export const MAX_PATH_LENGTH = 4096;

export const DocParams = Type.Object({
	path: Type.String({
		minLength: 1,
		maxLength: MAX_PATH_LENGTH,
		description: "Path to a .pdf, .docx, or .xlsx file, relative to the working directory (or absolute inside it).",
	}),
	startIndex: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Code-point offset to start from. Use this to read a truncated document in chunks.",
		}),
	),
	maxChars: Type.Optional(
		Type.Integer({
			minimum: MIN_CHARS,
			maximum: MAX_CHARS,
			description: "Maximum characters to return (default and ceiling: the configured maxChars).",
		}),
	),
});

export type DocArgs = Static<typeof DocParams>;

export const DocOutput = Type.Object({
	path: Type.String(),
	format: Type.String(),
	bytes: Type.Number(),
	chars: Type.Number(),
	startIndex: Type.Number(),
	nextIndex: Type.Number(),
	truncated: Type.Boolean(),
	text: Type.String(),
});

/** The runtime result, with `format` narrowed to the registry id. */
export type DocResult = Omit<Static<typeof DocOutput>, "format"> & { format: FormatId };
