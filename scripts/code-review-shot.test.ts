/**
 * The code-review shot's fixture, held to the tree it builds.
 *
 * The shot's page resolves its root through `effectiveRealCwd`, which prefers the session's
 * `PI_WORKTREE_ROOT` — so a capture taken from a worktree drew that worktree instead of the fixture,
 * and then died on a comment the wrong diff could not anchor (#927). The fixture's own builder
 * withdraws the override; this case drives it with the variable set, and gives the process back the
 * environment it found, because one `bun test` process runs every suite in a run.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { presetScope } from "../extensions/code-review/scope.ts";
import { ENV_ROOT } from "../lib/env.ts";
import { withEnv } from "../test/helpers/env.ts";
import { buildFixture, fixtureReview } from "./shots/code-review.ts";

/** Every fixture this case built, removed once it has asserted. */
const built: string[] = [];
afterAll(() => {
	for (const dir of built) rmSync(dir, { recursive: true, force: true });
});

describe("the review shot's fixture", () => {
	test("reads the checkout it built, not the session's worktree", async () => {
		const before = process.env[ENV_ROOT];
		const decoy = mkdtempSync(join(tmpdir(), "pi-shot-session-"));
		try {
			await withEnv({ [ENV_ROOT]: decoy }, async () => {
				const dir = buildFixture();
				built.push(dir);
				// A fixture is not a session: the shot withdrew the override rather than resolving through it.
				expect(process.env[ENV_ROOT]).toBeUndefined();
				const { current } = fixtureReview(dir);
				expect(realpathSync(current.place().root)).toBe(realpathSync(dir));
				const scope = presetScope("change", "main");
				if (scope === undefined) throw new Error("the change preset has no default to resolve");
				await current.openPage(scope, "change");
				const snapshot = await current.snapshot();
				if (snapshot.kind !== "snapshot") throw new Error(`the fixture drew no diff: ${snapshot.message}`);
				// The three files of the Aurora gateway, never the session's own checkout: the frame the
				// override used to draw had fifteen of them and no `gateway.ts` at the line the post names.
				expect(snapshot.snapshot.files.map((file) => file.rel).sort()).toEqual([
					"README.md",
					"gateway.ts",
					"limits.ts",
				]);
			});
		} finally {
			rmSync(decoy, { recursive: true, force: true });
		}
		// The next suite in this run inherits what it was handed, not the pin.
		expect(process.env[ENV_ROOT]).toBe(before);
	});
});
