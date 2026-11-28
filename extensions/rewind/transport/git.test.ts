/**
 * The pathspecs rewind sends git, whatever the caller's environment says.
 *
 * A path comes back from `git diff` and can hold `*`, `?`, or `[…]`; rewind reads it literally through
 * `--literal-pathspecs` rather than a `:(literal)` prefix, because a prefix is magic and magic is what
 * `GIT_LITERAL_PATHSPECS` turns off — which a Pi tool shell sets. These cases run with that variable
 * on, so the old prefix form fails here exactly as it failed in a session (#990).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { indexFileFor, runGit } from "../../../test/helpers/fixtures/rewind.ts";
import { execP, makeRepo, makeTempTracker } from "../../../test/helpers/git.ts";
import { withEnv } from "../../../test/helpers/env.ts";
import { nameStatus, restorePaths } from "./git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A repository whose one added file is named with a glob character. */
async function repoWithGlobFile(): Promise<{ repo: string; added: string }> {
	const repo = temps.track(await makeRepo());
	writeFileSync(join(repo, "weird[1].ts"), "export const w = 1;\n");
	await execP("git", ["add", "--", "weird[1].ts"], { cwd: repo });
	await execP("git", ["commit", "-qm", "add the glob-named file"], { cwd: repo });
	const added = (await execP("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
	return { repo, added };
}

/** The environment a Pi tool shell hands its children, which is what disables pathspec magic. */
const MAGIC_OFF = { GIT_LITERAL_PATHSPECS: "1" };

describe("literal pathspecs", () => {
	test("restores by name while the environment turns magic off", async () => {
		const { repo, added } = await repoWithGlobFile();
		writeFileSync(join(repo, "README.md"), "changed\n");
		writeFileSync(join(repo, "weird[1].ts"), "export const w = 2;\n");
		await withEnv(MAGIC_OFF, () => restorePaths(runGit, repo, added, indexFileFor(repo), ["README.md", "weird[1].ts"]));
		expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("hello\n");
		expect(readFileSync(join(repo, "weird[1].ts"), "utf8")).toBe("export const w = 1;\n");
	});

	test("names and lists a glob-named path while the environment turns magic off", async () => {
		const { repo, added } = await repoWithGlobFile();
		writeFileSync(join(repo, "weird[1].ts"), "export const w = 2;\n");
		await execP("git", ["commit", "-qam", "change it"], { cwd: repo });
		const changed = (await execP("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
		const listed = await withEnv(MAGIC_OFF, () => nameStatus(runGit, repo, added, changed, ["weird[1].ts"]));
		expect(listed).toEqual([{ path: "weird[1].ts", change: "modified" }]);
	});
});
