/**
 * The shared repository key: one identity per repository, shared by its
 * worktrees, and the working directory when git cannot answer.
 *
 * No git process starts: `repoKeyFor` takes any `exec` seam, so the double here
 * answers by argument. The paths that must be real are temp directories, resolved
 * with `realpathSync.native` because that is the spelling `repoRoot` returns: the
 * non-native call keeps Windows' 8.3 short name, which never compares equal.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tempDir, withEnv } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { ENV_ROOT } from "./env.ts";
import {
	normalizeRemoteUrl,
	REPO_KEY_LENGTH,
	repoIdOf,
	repoIdFor,
	repoKeyFor,
	repoKeyOf,
	rootCommitIdOf,
	settingsRootFor,
} from "./repo-key.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** An `exec` seam answering git's two identity questions from one common dir. */
function gitSeam(common: string, root: string | undefined, calls: string[][] = []) {
	return async (_command: string, args: string[]) => {
		calls.push(args);
		const stdout = args.includes("--git-common-dir") ? `${common}\n` : root === undefined ? "" : `${root}\n`;
		return { stdout, stderr: "", code: root === undefined && !args.includes("--git-common-dir") ? 1 : 0 };
	};
}

/** An `exec` seam that fails outright, the way a missing git binary does. */
function failingSeam() {
	return async () => {
		throw new Error("git is not installed");
	};
}

/** An `exec` seam answering the two identity questions, and refusing anything else. */
function identitySeam(answers: { remote?: string; root?: string }, calls: string[][] = []) {
	return async (_command: string, args: string[]) => {
		calls.push(args);
		const argv = args.join(" ");
		if (argv === "config --get remote.origin.url") {
			const found = answers.remote !== undefined;
			return { stdout: found ? `${answers.remote}\n` : "", stderr: "", code: found ? 0 : 1 };
		}
		if (argv === "rev-list --max-parents=0 HEAD") {
			const found = answers.root !== undefined;
			return { stdout: found ? `${answers.root}\n` : "", stderr: "", code: found ? 0 : 128 };
		}
		return { stdout: "", stderr: "", code: 128 };
	};
}

describe("repoKeyOf", () => {
	test("is a short hex digest", () => {
		const key = repoKeyOf("/repo/.git");
		expect(key).toMatch(/^[0-9a-f]+$/);
		expect(key).toHaveLength(REPO_KEY_LENGTH);
	});

	test("is stable for one identity and distinct across identities", () => {
		expect(repoKeyOf("/repo/.git")).toBe(repoKeyOf("/repo/.git"));
		expect(repoKeyOf("/repo/.git")).not.toBe(repoKeyOf("/other/.git"));
	});

	test("is pinned for a fixed path, so no refactor can move every store by accident", () => {
		// Every store on every machine is filed under this digest's siblings: a change here is a
		// migration (#771), never a tidy-up, and this line is what makes that unavoidable.
		expect(repoKeyOf("/repo/.git")).toBe("6b4ca2db35cf");
		expect(repoKeyOf("/home/me/repo/.git")).toBe("03ba1b3195ff");
	});
});

describe("normalizeRemoteUrl", () => {
	test("answers one string for every spelling of one remote", () => {
		for (const url of [
			"git@github.com:gavin-hu/my-pi-agent.git",
			"ssh://git@github.com/gavin-hu/my-pi-agent",
			"https://github.com/gavin-hu/my-pi-agent/",
			"https://user:token@github.com/gavin-hu/my-pi-agent.git",
			"https://GitHub.com/gavin-hu/my-pi-agent",
		]) {
			expect(normalizeRemoteUrl(url)).toBe("github.com/gavin-hu/my-pi-agent");
		}
	});

	test("lowers the host and keeps the path's case, because a host is case-insensitive and a path is not", () => {
		expect(normalizeRemoteUrl("ssh://git@GitHub.com:2222/Gavin-Hu/MyPi")).toBe("github.com/Gavin-Hu/MyPi");
	});

	test("has no answer for a remote that names no host", () => {
		expect(normalizeRemoteUrl("/srv/git/x.git")).toBeUndefined();
		expect(normalizeRemoteUrl("file:///srv/git/x.git")).toBeUndefined();
		expect(normalizeRemoteUrl("https://github.com")).toBeUndefined();
		expect(normalizeRemoteUrl("   ")).toBeUndefined();
	});
});

describe("repoIdOf", () => {
	test("is one id for one repository and two for two", () => {
		expect(repoIdOf("git@github.com:me/x.git")).toBe(repoIdOf("https://github.com/me/x"));
		expect(repoIdOf("https://github.com/me/x")).not.toBe(repoIdOf("https://github.com/me/y"));
		expect(repoIdOf("https://github.com/me/x")).toMatch(new RegExp(`^[0-9a-f]{${REPO_KEY_LENGTH}}$`));
	});

	test("is undefined when the remote names no host, so the chain falls to the history", () => {
		expect(repoIdOf("/srv/git/x.git")).toBeUndefined();
	});

	test("never equals the path key of the same string, which is what keeps the two spaces apart", () => {
		// The one input that could collide in principle: the same characters hashed by both spaces.
		expect(repoIdOf("https://host/owner/repo")).not.toBe(repoKeyOf("host/owner/repo"));
		expect(rootCommitIdOf("abc123")).not.toBe(repoKeyOf("abc123"));
	});
});

describe("rootCommitIdOf", () => {
	test("is one id whatever case a sha is spelled in, and one per history", () => {
		expect(rootCommitIdOf("ABC123")).toBe(rootCommitIdOf("abc123"));
		expect(rootCommitIdOf("abc123")).not.toBe(rootCommitIdOf("abc124"));
	});
});

describe("repoIdFor", () => {
	test("answers the remote's id, and asks the history nothing once it has", async () => {
		const calls: string[][] = [];
		const seam = identitySeam({ remote: "git@github.com:me/x.git", root: "abc123" }, calls);
		const identity = await repoIdFor({ exec: seam } as never, "/repo");
		expect(identity).toEqual({
			id: repoIdOf("git@github.com:me/x.git"),
			source: "remote",
			remote: "git@github.com:me/x.git",
		});
		expect(calls.map((args) => args.join(" "))).toEqual(["config --get remote.origin.url"]);
	});

	test("falls to the root commit when there is no remote", async () => {
		const identity = await repoIdFor({ exec: identitySeam({ root: "abc123" }) } as never, "/repo");
		expect(identity).toEqual({ id: rootCommitIdOf("abc123"), source: "root-commit" });
	});

	test("falls to the history when the remote names no host, because a local path is one machine's", async () => {
		const identity = await repoIdFor(
			{ exec: identitySeam({ remote: "/srv/git/x.git", root: "abc123" }) } as never,
			"/repo",
		);
		expect(identity).toEqual({ id: rootCommitIdOf("abc123"), source: "root-commit" });
	});

	test("answers none, with no id, when there is neither a remote nor a commit", async () => {
		expect(await repoIdFor({ exec: identitySeam({}) } as never, "/repo")).toEqual({ source: "none" });
	});

	test("never throws: a git that cannot start is the same answer as neither", async () => {
		expect(await repoIdFor({ exec: failingSeam() } as never, "/repo")).toEqual({ source: "none" });
	});
});

describe("repoKeyFor", () => {
	test("keys on the common git directory, so worktrees share one key", async () => {
		const main = realpathSync.native(tempDir("repo-key-main-"));
		temps.track(main);
		const seam = gitSeam("/repo/.git", main);
		const fromMain = await repoKeyFor({ exec: seam } as never, "/repo");
		const fromWorktree = await repoKeyFor({ exec: seam } as never, "/repo/.pi/worktrees/x");
		expect(fromMain.fromGit).toBe(true);
		expect(fromMain.root).toBe(main);
		expect(fromWorktree.key).toBe(fromMain.key);
		expect(fromMain.key).toBe(repoKeyOf("/repo/.git"));
	});

	test("keys on the root when git reports no common directory", async () => {
		const root = realpathSync.native(tempDir("repo-key-root-"));
		temps.track(root);
		const identity = await repoKeyFor({ exec: gitSeam("", root) } as never, root);
		expect(identity).toMatchObject({ root, key: repoKeyOf(root), fromGit: true });
	});

	test("falls back to the working directory outside a repository", async () => {
		const seam = async () => ({ stdout: "", stderr: "not a repository", code: 128 });
		const identity = await repoKeyFor({ exec: seam } as never, "/not/a/repo");
		expect(identity).toEqual({
			root: "/not/a/repo",
			key: repoKeyOf("/not/a/repo"),
			settingsRoot: "/not/a/repo",
			fromGit: false,
		});
	});

	test("falls back when git fails to run at all", async () => {
		const identity = await repoKeyFor({ exec: failingSeam() } as never, "/no/git/here");
		expect(identity).toEqual({
			root: "/no/git/here",
			key: repoKeyOf("/no/git/here"),
			settingsRoot: "/no/git/here",
			fromGit: false,
		});
	});

	test("asks git for both the common directory and the root", async () => {
		const root = realpathSync.native(tempDir("repo-key-asks-"));
		temps.track(root);
		const calls: string[][] = [];
		await repoKeyFor({ exec: gitSeam("/repo/.git", root, calls) } as never, root);
		expect(calls).toContainEqual(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		expect(calls).toContainEqual(["rev-parse", "--show-toplevel"]);
	});

	test("answers the checkout as the settings root, so a worktree reads the repository's file", async () => {
		const root = realpathSync.native(tempDir("repo-key-settings-"));
		temps.track(root);
		const worktree = join(root, ".pi", "worktrees", "x");
		const identity = await repoKeyFor({ exec: gitSeam(join(root, ".git"), worktree) } as never, worktree);
		// The card store's root is the tree the session sits in; the settings live in the checkout.
		expect(identity.root).toBe(worktree);
		expect(identity.settingsRoot).toBe(root);
	});

	test("settingsRootFor answers the checkout wherever the session sits", async () => {
		const root = realpathSync.native(tempDir("repo-key-settings-root-"));
		temps.track(root);
		const worktree = realpathSync.native(tempDir("repo-key-settings-wt-"));
		temps.track(worktree);
		// The session's active root is a worktree; the settings it reads and writes are the checkout's.
		const fromWorktree = await withEnv({ [ENV_ROOT]: worktree }, () =>
			settingsRootFor({ exec: gitSeam(join(root, ".git"), worktree) } as never, "/some/other/cwd"),
		);
		expect(fromWorktree).toBe(root);
	});

	test("keeps the working root when the common directory is not a checkout", async () => {
		const root = realpathSync.native(tempDir("repo-key-bare-"));
		temps.track(root);
		// A bare repository's common dir is not a `.git`, so there is no checkout to prefer.
		const identity = await repoKeyFor({ exec: gitSeam(join(root, "objects"), root) } as never, root);
		expect(identity.settingsRoot).toBe(root);
	});

	test("a nested path still keys the repository", async () => {
		const root = realpathSync.native(tempDir("repo-key-nested-"));
		temps.track(root);
		const identity = await repoKeyFor({ exec: gitSeam("/repo/.git", root) } as never, join(root, "src", "deep"));
		expect(identity.key).toBe(repoKeyOf("/repo/.git"));
	});
});
