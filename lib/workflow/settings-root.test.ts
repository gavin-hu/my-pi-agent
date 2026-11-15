/**
 * Where a worktree session reads its settings: the repository's checkout, not the worktree.
 *
 * `.pi/` is gitignored, so a fresh worktree has no `bytefly.json` and the defaults would answer
 * every question — a lane cap the repository never stated, a team it never named. The identity
 * `repoKeyFor` already resolves knows the checkout (the common git directory's parent), so the
 * config read takes its root from there; this suite proves the read, and `one-card.test.ts`
 * proves what the numbers then do.
 *
 * It is its own suite because `store.test.ts` is named at its height in `test/suite-sizes.test.ts`,
 * and a named suite may not grow.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_ROOT } from "../env.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { openBoard } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the settings a worktree session reads", () => {
	test("are the repository's: the checkout's file, not the worktree's defaults", async () => {
		const checkout = temps.track(tempDir("pi-checkout-"));
		const worktree = temps.track(tempDir("pi-worktree-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		mkdirSync(join(checkout, ".pi"), { recursive: true });
		writeFileSync(
			join(checkout, ".pi", "bytefly.json"),
			JSON.stringify({ board: { wip: { plan: 5, perOwner: 2 } }, team: { lead: "api-lead" } }),
		);
		// git answers from the session's tree: the worktree is its own toplevel, and the common
		// directory is the checkout's `.git` — whose parent is where the settings live.
		const pi = {
			exec: async (_command: string, args: string[]) =>
				args.includes("--git-common-dir")
					? { stdout: `${join(checkout, ".git")}\n`, stderr: "", code: 0 }
					: { stdout: `${worktree}\n`, stderr: "", code: 0 },
		} as unknown as Parameters<typeof openBoard>[0];

		const store = await withEnv({ [ENV_ROOT]: worktree }, () => openBoard(pi, worktree, { agentDir }));
		// The numbers are the checkout's, not `DEFAULT_WIP`'s, and the team is the one it names.
		expect(store.config().wip).toMatchObject({ plan: 5, perOwner: 2, execute: 5 });
		expect(store.config().lead).toBe("api-lead");
	});
});
