/**
 * The automatic label: the one git question at start, and what it settles.
 *
 * The git answer is a fixture in most cases, so one states what a machine's repository
 * said without paying for one; the real repository is the gated suite at the end.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { repoKeyFor } from "../../lib/repo-key.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { automaticLabel } from "./label.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const REPO = "/repo/my-pi-agent";
const WORKTREE = `${REPO}/.pi/worktrees/peer-shutdown`;

const PORCELAIN = [
	`worktree ${REPO}`,
	"HEAD 1234567890abcdef",
	"branch refs/heads/main",
	"",
	`worktree ${WORKTREE}`,
	"HEAD abcdef1234567890",
	"branch refs/heads/worktree-peer-shutdown",
	"",
].join("\n");

/** A host whose git answers with the repository's working trees, and logs the asks. */
function host(porcelain = PORCELAIN) {
	const calls: string[][] = [];
	const fake = createFakePi({
		exec: async (_command: string, args: string[]) => {
			calls.push(args);
			return { stdout: porcelain, stderr: "", code: 0 };
		},
	});
	// The one host surface this module reads; the rest of `ExtensionAPI` is not its business.
	const pi = fake.pi as unknown as Pick<ExtensionAPI, "exec">;
	return { pi, calls };
}

function context(cwd: string, sessionName: string): Pick<ExtensionContext, "sessionManager"> {
	const { ctx } = fakeCtx({ cwd, sessionName, sessionId: "s1" });
	return ctx as Pick<ExtensionContext, "sessionManager">;
}

describe("automaticLabel", () => {
	test("names a session sitting in a worktree after the repository", async () => {
		const { pi, calls } = host();
		expect(
			await automaticLabel(pi, {
				context: context(WORKTREE, "peer-shutdown"),
				cwd: WORKTREE,
				id: "s1",
				repo: { root: REPO, fromGit: true },
			}),
		).toBe("my-pi-agent");
		// One question, asked of the working trees: the answer is every checkout at once.
		expect(calls).toEqual([["worktree", "list", "--porcelain"]]);
	});

	test("declines a worktree's name seen from the main checkout, where /resume kept it", async () => {
		const { pi } = host();
		expect(
			await automaticLabel(pi, {
				context: context(REPO, "worktree-peer-shutdown"),
				cwd: REPO,
				id: "s1",
				repo: { root: REPO, fromGit: true },
			}),
		).toBe("my-pi-agent");
		expect(
			await automaticLabel(pi, {
				context: context(REPO, "peer-shutdown"),
				cwd: REPO,
				id: "s2",
				repo: { root: REPO, fromGit: true },
			}),
		).toBe("my-pi-agent");
	});

	test("keeps a name that is no checkout's", async () => {
		const { pi } = host();
		expect(
			await automaticLabel(pi, {
				context: context(REPO, "billing-core"),
				cwd: REPO,
				id: "s1",
				repo: { root: REPO, fromGit: true },
			}),
		).toBe("billing-core");
	});

	test("asks git nothing outside a repository, and names the directory", async () => {
		const { pi, calls } = host();
		expect(
			await automaticLabel(pi, {
				context: context("/tmp/scratch", "scratch"),
				cwd: "/tmp/scratch",
				id: "s1",
				repo: { root: "/tmp/scratch", fromGit: false },
			}),
		).toBe("scratch");
		expect(calls).toEqual([]);
	});
});

// The runtime reaches git only through `exec`, so this double needs nothing else.
const realGit = {
	exec: (command: string, args: string[], options?: { cwd?: string }) => execP(command, args, options),
} as unknown as Pick<ExtensionAPI, "exec">;

describe.skipIf(!runSlowSuites)("a real repository", () => {
	test("names a session in a worktree after the repository, not the worktree", async () => {
		const repo = temps.track(await makeRepo("pi-session-bus-label-"));
		const worktree = temps.track(join(repo, ".pi", "worktrees", "side"));
		await execP("git", ["worktree", "add", "-q", "-b", "worktree-side", worktree], { cwd: repo });
		const repository = basename(repo);
		const named = async (cwd: string, sessionName: string) =>
			automaticLabel(realGit, {
				context: context(cwd, sessionName),
				cwd,
				id: "s1",
				repo: await repoKeyFor(realGit, cwd),
			});

		// The worktree's own name, as a join inside it once stamped into Pi, then carried
		// into the main checkout by a `/resume` of the same session.
		expect(await named(worktree, "side")).toBe(repository);
		expect(await named(repo, "worktree-side")).toBe(repository);
	});
});
