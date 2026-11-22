/**
 * Moving one store from its old layout to its new home, once.
 *
 * Every per-repository store this package keeps moved from `<agent-dir>/<concept>/<key>` to
 * `<agent-dir>/repos/<id>/<concept>`, and the machines that already have one must not lose it. So
 * a store is *read* from both layouts and *written* to the new one, and the old directory is
 * taken across on the first read that misses: once, idempotently, and never before the new
 * contents have landed.
 *
 * Deferred by every caller (`await import()` on the read that misses) rather than statically
 * imported: a module evaluated at start costs one row per entry, and `test/dependencies.test.ts`
 * holds each row to a number that may only fall. A board whose store is already where it belongs
 * pays nothing for this file.
 */

import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type RepoKey, repoIdFor, repoKeyFor, repoStoreDir, storeIdOf } from "./repo-key.ts";

/**
 * The repository shape a store needs: where it is, its key, and whether git answered.
 *
 * `fromGit` is optional because one caller passes a seam (`session-bus`'s `options.repo`) that a
 * suite builds by hand and never asks that question of.
 */
export type StoreRepo = Pick<RepoKey, "root" | "key"> & { fromGit?: boolean };

/** What one attempt did, which is also what a caller may report. */
export type MigrationOutcome =
	/** The state was old-only and is now at its new home. */
	| "moved"
	/** The new home exists, so the old one was left exactly as it was. */
	| "already-moved"
	/** There is no old store: a fresh install, or one this build already moved. */
	| "nothing-to-move"
	/** The move failed; the old directory is still there and still readable. */
	| "failed";

/** Whether a path is there at all, which is the only question this module asks of one. */
async function present(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Take the old store across, once.
 *
 * The four cases are the whole contract, and each is a case in the suite: the new home exists →
 * the old is untouched (`already-moved`); the old is missing → nothing to do (`nothing-to-move`);
 * the new is missing and the old is there → the state moves (`moved`); a move that fails → the
 * old one is readable and `failed` is the answer. A second run is `already-moved`, which is what
 * makes calling it on every read safe.
 *
 * A rename across a filesystem boundary fails with `EXDEV`, so the fallback copies and only then
 * removes the old directory — nothing is deleted before its contents have landed. A copy that
 * dies half-way leaves a partial new home, which is removed here so the next attempt still sees
 * the old store rather than a truncated one at the new path.
 */
export async function migrateStoreDir(from: string, to: string): Promise<MigrationOutcome> {
	if (await present(to)) return "already-moved";
	if (!(await present(from))) return "nothing-to-move";
	try {
		await mkdir(dirname(to), { recursive: true });
		try {
			await rename(from, to);
		} catch {
			await cp(from, to, { recursive: true, errorOnExist: true, force: false });
			await rm(from, { recursive: true, force: true });
		}
		return "moved";
	} catch {
		// A half-written new home would read as "already moved" next time, so it goes; the old
		// store is the one source of truth until a move actually succeeds.
		await rm(to, { recursive: true, force: true }).catch(() => undefined);
		return "failed";
	}
}

/** Where one concept's store lives for a working directory, once it is resolved. */
export interface StoreLocation {
	/** The directory the store is filed in: `<agent-dir>/repos/<id>/<concept>`. */
	dir: string;
	/** The identity it is filed under — a shared id, or `local-<pathKey>`. */
	id: string;
	/** The repository the directory resolved to. */
	repo: StoreRepo;
}

/**
 * Resolve a concept's store directory, and take any store an older build left at the flat
 * spelling across, once.
 *
 * The one body every owner needs: identity is asked once per session (two git calls), the name
 * comes from {@link storeIdOf}, and the old directory is the caller's to name because each concept
 * spelled it differently (`plans/<key>`, `session-bus/<key>`, `jobs/<project>`). Deferred by every
 * caller with `import()`, so a session that never touches a store pays nothing for the identity or
 * the mover.
 */
export async function repoStoreDirFor(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	agentDir: string,
	concept: string,
	legacy: (repo: StoreRepo) => string,
	options: {
		/**
		 * A repository a caller has already resolved, for the one place that takes one as a seam
		 * (`session-bus`'s `options.repo`, which a suite supplies instead of a git double). Absent is
		 * the ordinary case: the identity is asked for here, once.
		 */
		repo?: StoreRepo;
	} = {},
): Promise<StoreLocation> {
	const repo = options.repo ?? (await repoKeyFor(pi, cwd));
	const id = storeIdOf(await repoIdFor(pi, cwd), repo.key);
	const dir = repoStoreDir(agentDir, id, concept);
	await migrateStoreDir(legacy(repo), dir);
	return { dir, id, repo };
}
