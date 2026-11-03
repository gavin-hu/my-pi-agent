/**
 * The commit a finished card lands as: the one whose message names it, or none.
 *
 * `HEAD` is not that fact — a card moved from a checkout the work never reached would name
 * whatever commit happened to be there — so the move's read is pinned here, against real
 * repositories with real histories. `tools.test.ts` is named at its height in
 * `test/suite-sizes.test.ts`, which is why this suite exists.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import type { FakePiOptions } from "../../test/helpers/fakes.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;
/**
 * The session that signs: the board's lead, and so not the one holding the card — a
 * spot-check by the holder is the gate's own refusal, not this suite's subject.
 */
const REVIEWER = { id: "s-reviewer", label: "reviewer" };

/** A board in `cwd` where git really runs, so a case can build the history the move reads. */
function board(cwd: string) {
	const real: FakePiOptions["exec"] = async (command, args, options) => {
		const result = await execP(command, args, { cwd: options?.cwd });
		return { stdout: result.stdout, stderr: result.stderr, code: result.code };
	};
	const harness = boardHarness({ cwd, exec: real, lead: REVIEWER.label, now: NOW, track: temps.track });
	registerTools(harness.fake.pi, harness.runtime);
	const tool = harness.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		ctx: harness.ctx,
		runtime: harness.runtime,
		/** Run one action. */
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, harness.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		},
	};
}

type Board = ReturnType<typeof board>;

/**
 * One card, spot-checked and ready to finish, so a case is about the move itself.
 *
 * The gates are walked directly because they are somebody else's cases: what this suite
 * reads is the commit the tool's own `move` records.
 */
async function readyToFinish(one: Board): Promise<void> {
	await one.call({ action: "add", title: "One" });
	const store = await one.runtime.store(one.ctx.cwd);
	const me = await one.runtime.who(one.ctx, one.ctx.cwd);
	const dir = await one.runtime.planDir(one.ctx.cwd);
	mkdirSync(dir, { recursive: true });
	const plan = join(dir, "one.md");
	writeFileSync(plan, "# One\n");
	await advance(store, "1", "execute", { owner: me, planPath: plan }, NOW);
	await store.mutate("1", { kind: "review" }, REVIEWER, NOW);
}

/** Commit `message` in `cwd`, and answer it shortened as a card records one. */
async function commitAs(cwd: string, message: string): Promise<string> {
	await execP("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd });
	const head = await execP("git", ["rev-parse", "HEAD"], { cwd });
	return head.stdout.trim().slice(0, 7);
}

describe("the commit a card landed as", () => {
	test("records the one that names the card, not whichever one is at HEAD", async () => {
		const cwd = temps.track(await makeRepo("pi-board-landed-"));
		const one = board(cwd);
		await readyToFinish(one);
		// The card names itself in the merge that closes it, and the commit after it has nothing
		// to do with the card: recording `HEAD` would report the unrelated one, which is the
		// failure this suite is here for.
		const naming = await commitAs(cwd, "Merge branch 'worktree-one-1' (#1, the change)");
		await commitAs(cwd, "chore(other): an unrelated commit");
		const done = await one.call({ action: "move", card: "1", lane: "done" });
		expect(done.details.card?.landed?.commit).toBe(naming);
		expect(resultText(done)).toContain(`landed: ${naming}`);
		expect(resultText(await one.call({ action: "list", lane: "done" }))).toContain(`landed ${naming}`);
	});

	test("records nothing when no commit names the card", async () => {
		const cwd = temps.track(await makeRepo("pi-board-unlanded-"));
		const one = board(cwd);
		await readyToFinish(one);
		// A history that names a different card — `#10` is the near miss a bare substring search
		// would take for `#1` — so this finish has no commit of its own to report, and the card
		// says nothing rather than naming somebody else's.
		await commitAs(cwd, "Merge branch 'worktree-other-10' (#10, another change)");
		const done = await one.call({ action: "move", card: "1", lane: "done" });
		expect(done.details.card?.lane).toBe("done");
		expect(done.details.card?.landed).toBeUndefined();
		expect(resultText(done)).not.toContain("landed");
	});
});
