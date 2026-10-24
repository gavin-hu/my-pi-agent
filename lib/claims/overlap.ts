/**
 * Claim overlap (pure).
 *
 * Two things in this package need the same answer to "do these paths collide?":
 * `session-bus` when a session claims a path, and plan approval when a proposed
 * split names its units. They must agree, because a split that passes validation
 * and then conflicts at claim time — or the reverse — teaches the user that a
 * claim is arbitrary. So the predicate lives here once and both call it.
 *
 * A claim on a directory covers every file below it, in either direction, and a
 * claim is always a repository-relative, posix-separated path: the caller
 * normalizes first, because a Windows spelling (`a\b`) and a posix one (`a/b`)
 * naming the same file must not read as two claims.
 */

/** A repository-relative path with one separator and no trailing slash. */
export function normalizeClaimPath(raw: string): string {
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

/** The first two prefixes in `paths` that collide, if any. */
export function findClaimOverlap(paths: readonly string[]): [string, string] | undefined {
	for (let i = 0; i < paths.length; i++) {
		for (let j = i + 1; j < paths.length; j++) {
			if (claimsConflict(paths[i], paths[j])) return [paths[i], paths[j]];
		}
	}
	return undefined;
}
