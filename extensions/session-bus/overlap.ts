/**
 * Claim overlap (pure).
 *
 * The bus's one answer to "do these paths collide?": the runtime checks it before
 * a claim is written, and the store checks it when a claim is read back. Two
 * copies would let a claim succeed here and read back as a conflict there, which
 * teaches the user that a claim is arbitrary.
 *
 * One export. `normalizeClaimPath` is the predicate's own step — a spellings rule
 * with a single caller, inside this module — so a caller cannot normalize a path
 * one way and compare it another.
 *
 * A claim on a directory covers every file below it, in either direction, and a
 * claim is always a repository-relative, posix-separated path: both sides are
 * normalized here, because a Windows spelling (`a\b`) and a posix one (`a/b`)
 * naming the same file must not read as two claims.
 */

/** A repository-relative path with one separator and no trailing slash. */
function normalizeClaimPath(raw: string): string {
	const posix = raw.trim().replace(/\\/g, "/");
	const trimmed = posix
		.replace(/^\.\//, "")
		.replace(/\/{2,}/g, "/")
		.replace(/\/+$/, "");
	return trimmed === "." ? "" : trimmed;
}

/** Whether one claim covers the other path in either direction. */
export function claimsConflict(a: string, b: string): boolean {
	const left = normalizeClaimPath(a);
	const right = normalizeClaimPath(b);
	// The root claim (an empty path, or ".") covers everything below it.
	if (left === "" || right === "") return true;
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
