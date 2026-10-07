/**
 * Path-argument detection for read-only guards (pure).
 *
 * A tool's MCP `readOnlyHint` is a claim, not a proof. This finds path-like
 * values in a tool call's input so a caller can refuse to trust the hint for
 * tools that may touch files. It recognizes input shapes only and never touches
 * the disk, so it is safe to run on any tool call.
 */

/** Argument names that commonly name a filesystem path. */
export const PATH_KEYS: ReadonlySet<string> = new Set([
	"path",
	"paths",
	"file",
	"files",
	"file_path",
	"filePath",
	"filename",
	"filenames",
	"dir",
	"directory",
	"target",
	"targets",
	"source",
	"sources",
	"destination",
	"dest",
]);

/** Whether `value` is a string or an array holding at least one string. */
function hasString(value: unknown): boolean {
	return typeof value === "string" || (Array.isArray(value) && value.some((item) => typeof item === "string"));
}

/** Whether a tool call's input carries at least one path-like argument. */
export function hasPathInput(input: unknown): boolean {
	if (typeof input !== "object" || input === null) return false;
	for (const [key, value] of Object.entries(input)) {
		if (PATH_KEYS.has(key) && hasString(value)) return true;
	}
	return false;
}
