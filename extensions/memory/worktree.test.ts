/**
 * Where the project store lives: when the session is isolated, and when there is no repository
 * at all.
 *
 * `.pi/` is gitignored, so a worktree that resolved its own root kept a second store that died
 * with the tree — and the worktree is where the work happens. The fixture cases run everywhere;
 * the real-`git worktree` case is gated behind the slow suite, because it is the one that would
 * have caught the defect.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ENV_ROOT } from "../../lib/env.ts";
import { repoKeyOf } from "../../lib/repo-key.ts";
import { useEnv, withAgentDir } from "../../test/helpers/env.ts";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { cleanup, execP, makeRepo } from "../../test/helpers/git.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { formatHealth, memoryHealth } from "./doctor.ts";
import { createMemoryRuntime } from "./runtime.ts";
import { resolveMemoryPaths } from "./store.ts";

/** The path a worktree occupies inside its checkout. */
const WORKTREE_TASK = [".pi", "worktrees", "task"];

/**
 * A `pi` whose `exec` runs the real command: a linked worktree's answer is the thing under
 * test, so nothing may fake it. `execP` never truncates its 16 MiB buffer.
 */
const realPi: Pick<ExtensionAPI, "exec"> = {
	exec: async (command, args, options) => ({
		...(await execP(command, args, { cwd: options?.cwd })),
		truncated: false,
	}),
};

describe("an isolated session", () => {
	let suite: MemorySuite;

	beforeEach(() => {
		suite = memorySuite({ worktree: true });
	});

	afterEach(() => {
		suite.dispose();
	});

	test("resolves the checkout's store, not the worktree's", async () => {
		const paths = await resolveMemoryPaths(suite.pi, suite.cwd);

		expect(paths.project).toBe(suite.projectPath);
		expect(paths.project).not.toContain(join(...WORKTREE_TASK));
	});

	test("writes a note in the worktree into the checkout's file", async () => {
		const runtime = createMemoryRuntime(suite.pi);
		await runtime.load(suite.cwd, true);

		await runtime.add("project", "learned in a worktree");

		expect(suite.read("project")).toContain("- learned in a worktree");
		runtime.reset();
	});

	test("reads a note the checkout already holds", async () => {
		suite.write("project", "- from the checkout\n");
		const runtime = createMemoryRuntime(suite.pi);
		await runtime.load(suite.cwd, true);

		expect(runtime.entries().project).toEqual([{ text: "from the checkout" }]);
		runtime.reset();
	});

	test("names the file it read in the doctor report", async () => {
		const runtime = createMemoryRuntime(suite.pi);
		await runtime.load(suite.cwd, true);
		const paths = runtime.paths();
		if (!paths) throw new Error("the session did not resolve its stores");

		const text = formatHealth(
			memoryHealth({
				entries: runtime.entries(),
				sizes: runtime.sizes(),
				paths,
				trusted: runtime.trusted(),
				config: runtime.config(),
			}),
		);

		expect(text).toContain(`0 notes · ${suite.projectPath}`);
		runtime.reset();
	});
});

describe("a working directory outside a repository", () => {
	/** A `pi` whose git answers "not a repository", as it does outside one. */
	const noGit: Pick<ExtensionAPI, "exec"> = {
		exec: async () => ({
			stdout: "",
			stderr: "fatal: not a git repository",
			code: 128,
			killed: false,
			truncated: false,
		}),
	};

	test("resolves to itself, because there is no checkout to share", async () => {
		// The session's own root would answer instead, and it is the one thing that must not.
		const env = useEnv({ [ENV_ROOT]: undefined });
		try {
			const nowhere = join(tmpdir(), "pi-memory-outside-git");

			const paths = await resolveMemoryPaths(noGit, nowhere);

			// No checkout to share, and no identity either: the store is still inside the one layout,
			// under a `local-<pathKey>` name rather than in a `.pi/` of its own.
			expect(paths.project).toBe(join(dirname(paths.global), "repos", `local-${repoKeyOf(nowhere)}`, "memory.md"));
		} finally {
			env.restore();
		}
	});
});

describe.skipIf(!runSlowSuites)("the store of a real linked worktree", () => {
	let repo: string | undefined;
	let worktree: string | undefined;
	let env: { restore: () => void } | undefined;

	beforeEach(() => {
		// The suite may itself be running inside a worktree, and the store resolves through
		// `PI_WORKTREE_ROOT`: pin it away so the case is about git's answer and nothing else.
		env = useEnv({ [ENV_ROOT]: undefined });
	});

	afterEach(() => {
		env?.restore();
		cleanup(repo, worktree);
		repo = undefined;
		worktree = undefined;
	});

	test("a note written in a worktree outlives the worktree", async () => {
		await withAgentDir(async () => {
			repo = await makeRepo("pi-memory-worktree-");
			worktree = join(repo, ...WORKTREE_TASK);
			const added = await execP("git", ["worktree", "add", "-q", "-b", "task", worktree], { cwd: repo });
			expect(added.code).toBe(0);

			const runtime = createMemoryRuntime(realPi);
			await runtime.load(worktree, true);
			// The property, not the spelling: the store is outside the worktree — so removing the
			// tree cannot take the notes with it — and inside the agent directory, where the other
			// machine's copy of it belongs. Both were once one path inside the checkout.
			const store = runtime.paths()?.project ?? "";
			expect(store.includes(join(repo, ".pi"))).toBe(false);
			expect(store).toContain(join("repos", ""));
			await runtime.add("project", "written in a worktree");
			runtime.reset();

			const removed = await execP("git", ["worktree", "remove", worktree], { cwd: repo });
			expect(removed.code).toBe(0);

			const checkout = createMemoryRuntime(realPi);
			await checkout.load(repo, true);
			expect(checkout.entries().project).toEqual([{ text: "written in a worktree" }]);
			checkout.reset();
		});
	});
});
