/**
 * Claim overlap (pure).
 *
 * The bus's one answer to "do these paths collide?": the runtime checks it before
 * a claim is written, and the store checks it when a claim is read back. Two
 * copies would let a claim succeed here and read back as a conflict there, which
 * teaches the user that a claim is arbitrary.
 *
 * Two exports, because they are one subject — what collides, and who wins the collision: the
 * predicate, and `keepsOverlap`, the settlement rule for two claims already published. The second
 * lives here rather than in `store.ts` because that module is at its line bar, and it belongs to
 * this one anyway: it is about two overlapping claims, not about a path.
 *
 * `normalizeClaimPath` stays the predicate's own step — a spellings rule with a single caller, inside
 * this module — so a caller cannot normalize a path one way and compare it another.
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
/**
 * Which of two claims on overlapping paths keeps: the one published first, and the smaller owner
 * when both landed in the same tick.
 *
 * A rule rather than a heuristic, and stated as one because it decides a race. It is
 * **antisymmetric** — both claimants compute the same verdict from the same two facts, so whichever
 * of them re-reads second agrees with the one that re-read first, and exactly one backs off — and it
 * is **total**, because `(mtimeMs, owner)` orders any two claims, so three overlapping batches
 * cannot cycle.
 *
 * The mtime, not the record's `at`: `at` is the writer's own clock and two sessions' clocks are not
 * comparable, while the file's mtime is the instant both of them can see — `claimOne` links a
 * written temp file, and the link keeps the temp's write time.
 */
export function keepsOverlap(
	mine: { mtimeMs: number; owner: string },
	theirs: { mtimeMs: number; owner: string },
): boolean {
	if (mine.mtimeMs !== theirs.mtimeMs) return mine.mtimeMs < theirs.mtimeMs;
	return mine.owner < theirs.owner;
}
