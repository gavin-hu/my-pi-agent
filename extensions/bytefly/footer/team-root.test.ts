/**
 * The footer's team read, asked from a worktree.
 *
 * A bar draws a name only while the repository's team holds it, and the team lives in the
 * checkout: `.pi/` is gitignored in a worktree, so reading the session's own tree would draw the
 * loader's default five while the board held the names the repository states. `worktreeTeammateReader`
 * is the seam that resolves the settings root before the read; this suite proves it answers the
 * checkout's names and refuses everything else.
 *
 * It is its own suite because `footer.test.ts` is named at its height in `test/suite-sizes.test.ts`,
 * and a named suite may not grow.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { worktreeTeammateReader } from "./collect/team.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A git seam answering the two identity questions from one common directory. */
function gitSeam(common: string, root: string) {
	return async (_command: string, args: string[]) => ({
		stdout: args.includes("--git-common-dir") ? `${common}\n` : `${root}\n`,
		stderr: "",
		code: 0,
	});
}

describe("the footer's team read", () => {
	test("answers the checkout's names from a worktree, and nothing else", async () => {
		const checkout = temps.track(tempDir("pi-footer-checkout-"));
		const worktree = temps.track(tempDir("pi-footer-worktree-"));
		mkdirSync(join(checkout, ".pi"), { recursive: true });
		writeFileSync(join(checkout, ".pi", "bytefly.json"), JSON.stringify({ team: { teammates: ["api-lead"] } }));

		const reader = await worktreeTeammateReader({ exec: gitSeam(join(checkout, ".git"), worktree) } as never, worktree);
		expect(reader("api-lead")).toBe("api-lead");
		// The loader's default names are not this repository's team, so the chip draws none of them.
		expect(reader("gavin")).toBeNull();
		expect(reader(null)).toBeNull();
	});
});
