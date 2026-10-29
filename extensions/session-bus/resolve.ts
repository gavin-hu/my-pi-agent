/**
 * A claim path as the store keeps it: repository-relative, posix, canonical.
 *
 * A path is data — it is resolved against the repository root, and canonicalised
 * through its real target before it is compared or stored — so a symlinked
 * spelling inside the repository and the file it names are one claim, and a path
 * that leaves the repository is refused before anything is written.
 *
 * The caller hands in paths that are already relative to the repository (the
 * spelling rule is `protocol.ts`'s), so what is decided here is what they *resolve*
 * to: the root itself, a target outside it, or a claim.
 *
 * `lib/path.ts` owns the containment predicates; this owns the claim's shape.
 */

import { join, relative, sep } from "node:path";
import { isInside, realPathOfNearest } from "../../lib/path.ts";

/** A path this module declined, with the reason a caller can print. */
export interface ClaimPathError {
	/** The path as the caller passed it, so a refusal names what it read. */
	path: string;
	/** Why it cannot be a claim. */
	reason: string;
}

/** Every path resolved and deduplicated, or the first one refused. */
export type ResolvedClaimPaths = { paths: string[] } | { error: ClaimPathError };

/**
 * The wording of the one refusal, shared so approval and the bus cannot phrase it
 * two ways: the caller prefixes the subject it knows (a unit, or a session's call).
 */
export function claimPathMessage(error: ClaimPathError): string {
	return `path "${error.path}" ${error.reason}.`;
}

/**
 * What the root itself resolves to, which is never a claim: it would cover every
 * file in the repository, so a unit that lists it owns the repository.
 */
const ROOT_ITSELF = "is the repository, not a path in it";

/** What a path outside the root resolves to. */
const OUTSIDE = "does not resolve to a file in the repository";

/**
 * Resolve `paths` against `root`, or refuse the first one that is not in it.
 *
 * A path that does not exist yet is accepted: `realPathOfNearest` resolves the
 * nearest existing ancestor, so a unit may name the directory its work creates.
 */
export function resolveClaimPaths(root: string, paths: readonly string[]): ResolvedClaimPaths {
	const realRoot = realPathOfNearest(root);
	const canonical: string[] = [];
	for (const path of paths) {
		const target = realPathOfNearest(join(root, path));
		const rel = relative(realRoot, target);
		if (rel === "") return { error: { path, reason: ROOT_ITSELF } };
		if (!isInside(realRoot, target)) return { error: { path, reason: OUTSIDE } };
		const normalized = rel.split(sep).join("/");
		if (!canonical.includes(normalized)) canonical.push(normalized);
	}
	return { paths: canonical };
}
