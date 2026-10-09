/**
 * Path-argument detection for read-only guards (pure).
 *
 * A tool's MCP `readOnlyHint` is a claim, not a proof. This finds path-like
 * values in a tool call's input so a caller can refuse to trust the hint for
 * tools that may touch files. It recognizes input shapes only and never touches
 * the disk, so it is safe to run on any tool call.
 *
 * The scan is deliberately over-eager: it walks nested objects and arrays,
 * matches path-ish key *words* (so `cwd`, `root`, `outputDir`, `source_files`
 * count), and flags strings with a strong filesystem shape. A false positive
 * only refuses a tool, and the known readers are allow-listed by the caller.
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
	"folder",
	"folders",
	"target",
	"targets",
	"source",
	"sources",
	"destination",
	"dest",
	"root",
	"cwd",
	"glob",
	"globs",
	"include",
	"includes",
	"exclude",
	"excludes",
]);

/**
 * Words that mark a key as path-carrying. A key is split on camelCase and
 * non-alphanumerics, so `outputDir`, `file_path`, and `SourceFiles` all match.
 */
const PATH_KEY_WORDS: ReadonlySet<string> = new Set([
	"path",
	"paths",
	"file",
	"files",
	"filename",
	"filenames",
	"dir",
	"dirs",
	"directory",
	"directories",
	"folder",
	"folders",
	"root",
	"cwd",
	"glob",
	"globs",
	"dest",
	"destination",
	"source",
	"sources",
	"target",
	"targets",
	"include",
	"includes",
	"exclude",
	"excludes",
]);

/** Maximum object/array nesting the scan will follow. */
const MAX_DEPTH = 8;

/** Absolute roots common enough to treat a bare `/name` as a path. */
const ABSOLUTE_ROOTS =
	/^\/(?:tmp|etc|home|usr|var|opt|root|Users|private|mnt|srv|bin|lib|dev|proc|sys|Library)(?:\/|$)/;

/** Whether `value` is a string or an array holding at least one string. */
function hasString(value: unknown): boolean {
	return typeof value === "string" || (Array.isArray(value) && value.some((item) => typeof item === "string"));
}

/** Whether a key names a filesystem path, by exact name or by its words. */
function pathLikeKey(key: string): boolean {
	if (PATH_KEYS.has(key)) return true;
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	return words.some((word) => PATH_KEY_WORDS.has(word));
}

/** Whether a string has a strong filesystem-path shape (URLs are excluded). */
function looksLikePath(value: string): boolean {
	const text = value.trim();
	if (text === "") return false;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false; // a URL, not a path
	if (/^[A-Za-z]:[\\/]/.test(text)) return true; // a Windows drive
	if (text.startsWith("~")) return true;
	if (/^\.\.?[\\/]/.test(text)) return true; // ./ or ../
	if (text.includes("\\")) return true;
	if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/.test(text)) return true; // a relative path
	return ABSOLUTE_ROOTS.test(text);
}

/** Depth-limited recursive scan for a path-like key or value. */
function scan(value: unknown, depth: number): boolean {
	if (depth > MAX_DEPTH) return false;
	if (typeof value === "string") return looksLikePath(value);
	if (Array.isArray(value)) return value.some((item) => scan(item, depth + 1));
	if (typeof value === "object" && value !== null) {
		for (const [key, nested] of Object.entries(value)) {
			if (pathLikeKey(key) && hasString(nested)) return true;
			if (scan(nested, depth + 1)) return true;
		}
	}
	return false;
}

/** Whether a tool call's input carries at least one path-like argument. */
export function hasPathInput(input: unknown): boolean {
	if (typeof input !== "object" || input === null) return false;
	return scan(input, 0);
}
