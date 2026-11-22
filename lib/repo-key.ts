/**
 * The per-repository storage key that outlives one checkout.
 *
 * Two extensions file state by repository — `session-bus` its sessions, mail, and
 * claims, `plan` its plans — and both must resolve the same key from any
 * worktree, so a plan approved in `.pi/worktrees/x` is the same plan from the
 * main checkout. The key is the repository's *common* git directory, which every
 * worktree of that repository shares; outside a repository the working directory
 * is the identity.
 *
 * Hashing keeps a mail directory, a claims directory, and a plans directory short
 * enough to read and safe on every filesystem, while staying unique per
 * repository.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "./env.ts";
import { createExecRunner, gitCommonDir, remoteUrl, repoRoot, rootCommit } from "./git/index.ts";

/** Hex characters kept from the digest: collision-free in practice and short enough for a path. */
export const REPO_KEY_LENGTH = 12;

/** The key for one identity string, hashed and shortened. */
export function repoKeyOf(value: string): string {
	return createHash("sha256").update(canonical(value)).digest("hex").slice(0, REPO_KEY_LENGTH);
}

/**
 * One path, one spelling.
 *
 * git prints the path it was told to work from, so a repository reached through a
 * symlinked prefix reports a different common dir for the same repository. Two
 * spellings would file one repository's plans and claims under two keys, so the
 * real path is what gets hashed; a path that cannot be resolved keeps its own
 * spelling rather than failing.
 */
function canonical(value: string): string {
	try {
		return realpathSync.native(value);
	} catch {
		return value;
	}
}

/** A resolved repository identity. */
export interface RepoKey {
	/** Absolute repository root, or `cwd` when git did not answer. */
	root: string;
	/** The shared key, derived from the common git directory. */
	key: string;
	/**
	 * Whether git resolved the repository. A caller that needs a *project-local*
	 * location branches on this; one that only needs a stable directory does not.
	 */
	fromGit: boolean;
	/**
	 * Where the repository keeps its project settings: the checkout's root, which is the
	 * parent of the common git directory.
	 *
	 * A worktree's {@link RepoKey.root} is the worktree, and `.pi/` is gitignored there, so the
	 * settings a repository states live in the checkout both trees share. Outside git, or when
	 * the common directory is not a `.git` (a bare repository, a submodule's store), this is
	 * {@link RepoKey.root} — the nearest answer that exists.
	 */
	settingsRoot: string;
}

/**
 * The repository's settings root for a working directory: the checkout a config read or write
 * targets.
 *
 * The cwd a command receives is the session's, which in a worktree is the worktree — where `.pi/`
 * is gitignored. Settings are the repository's, so a command that reads one and then writes it,
 * and a surface that only reads it, all resolve the same root the board's store does.
 */
export async function settingsRootFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<string> {
	return (await repoKeyFor(pi, resolveEffectiveCwd(cwd))).settingsRoot;
}

/**
 * The checkout a common git directory belongs to, or `root` when it names no `.git`.
 *
 * One question, because the two answers are different trees: a linked worktree's common dir is
 * the main checkout's `.git`, whose parent is the checkout. A bare repository's common dir, or a
 * submodule's store, is not a `.git` — there the working root is the only place settings can be.
 */
function settingsRootOf(common: string | undefined, root: string): string {
	return common !== undefined && basename(common) === ".git" ? dirname(common) : root;
}

/**
 * Resolve the repository identity for `cwd`.
 *
 * Never throws: without git, or when a git call fails, the working directory is
 * the identity — which is what a caller outside a repository wants anyway.
 */
export async function repoKeyFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<RepoKey> {
	try {
		const run = createExecRunner(pi);
		const [common, root] = await Promise.all([gitCommonDir(run, cwd), repoRoot(run, cwd)]);
		if (root)
			return { root, key: repoKeyOf(common ?? root), settingsRoot: settingsRootOf(common, root), fromGit: true };
	} catch {
		// Fall through: no git, or a git call that failed, is the same answer here.
	}
	return { root: cwd, key: repoKeyOf(cwd), settingsRoot: cwd, fromGit: false };
}

// --- The identity two machines share -----------------------------------------

/**
 * The prefixes the two key spaces hash, so a digest from one can never be read as the other.
 *
 * `repoKeyOf` hashes a bare path and keeps doing so — prefixing it would move every store on
 * every machine, and moving stores is #771's job. The sharing ids carry their own prefix instead.
 */
const REMOTE_PREFIX = "remote:";
const ROOT_COMMIT_PREFIX = "root:";

/**
 * A remote URL reduced to the one string two machines can agree on.
 *
 * `git@host:owner/repo.git`, `ssh://git@host/owner/repo` and `https://host/owner/repo/` name one
 * repository, so the scheme, any credentials, a port, a trailing `.git` and the surrounding
 * slashes go, and the host's case is lowered because a host is case-insensitive. The path's case
 * is kept, because a path is not. A remote that names no host — a local path, `file:///srv/x` —
 * has no answer: it is one machine's, and `undefined` says so rather than inventing an id.
 */
export function normalizeRemoteUrl(url: string): string | undefined {
	const text = url.trim();
	if (text === "") return undefined;
	// git's scp-like shorthand: `[user@]host:owner/repo`, with no scheme and no slashes.
	const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.+)$/.exec(text);
	if (scp?.[1] !== undefined && scp[2] !== undefined) return hostAndPath(scp[1], scp[2]);
	// `scheme://[user@]host[:port][/owner/repo]`, any scheme git accepts.
	const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)(\/.*)?$/i.exec(text);
	if (scheme?.[1] !== undefined) return hostAndPath(scheme[1], scheme[2] ?? "");
	return undefined;
}

/** `host/owner/repo`: a lowered host without its port, and a path without slashes or `.git`. */
function hostAndPath(host: string, rest: string): string | undefined {
	const hostname = host.toLowerCase().split(":")[0] ?? "";
	const path = rest
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "");
	if (hostname === "" || path === "") return undefined;
	return `${hostname}/${path}`;
}

/**
 * The id a remote names, or `undefined` when it names no host to agree on.
 *
 * The digest is {@link repoKeyOf}'s — one body for "hash an identity string" — with the remote
 * prefix in the preimage, which is what keeps this id out of the path key's space.
 */
export function repoIdOf(url: string): string | undefined {
	const normalized = normalizeRemoteUrl(url);
	return normalized === undefined ? undefined : repoKeyOf(`${REMOTE_PREFIX}${normalized}`);
}

/** The id a root commit names: the fallback for a repository with no remote, prefixed the same way. */
export function rootCommitIdOf(sha: string): string {
	return repoKeyOf(`${ROOT_COMMIT_PREFIX}${sha.trim().toLowerCase()}`);
}

/** Which rung of the chain answered. */
export type RepoIdentitySource = "remote" | "root-commit" | "none";

/** A repository's cross-machine identity. */
export interface RepoIdentity {
	/** The id both machines compute; absent when this repository has neither a remote nor a commit. */
	id?: string;
	source: RepoIdentitySource;
	/** The remote as git spelled it, when one answered. */
	remote?: string;
}

/**
 * Resolve the identity a store may be shared under: the remote, else the first root commit, else
 * nothing.
 *
 * Kept out of `repoKeyFor` on purpose: that answers every caller on the start path, and two more
 * git calls per resolution is what a store that is already local must not pay. A git that cannot
 * start, a repository with no remote and an unborn history all answer the same way — `none` —
 * which is the one state #770 and #771 have to branch on rather than invent an id for.
 */
export async function repoIdFor(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<RepoIdentity> {
	try {
		const run = createExecRunner(pi);
		const remote = await remoteUrl(run, cwd);
		const fromRemote = remote === undefined ? undefined : repoIdOf(remote);
		// A remote that names no host (a local path) is not an identity: fall to the history.
		if (fromRemote !== undefined) return { id: fromRemote, source: "remote", remote };
		const root = await rootCommit(run, cwd);
		if (root !== undefined) return { id: rootCommitIdOf(root), source: "root-commit" };
	} catch {
		// A git that cannot start is the same answer as a repository with neither.
	}
	return { source: "none" };
}
