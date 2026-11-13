/**
 * The run a spot-check makes, over the tool: the command its card's contract names, and what the
 * sign records when it passes or refuses it.
 *
 * The state machine's answer is `lib/board/signs.test.ts`, and the seam's is
 * `lib/board/verify.test.ts`; what this suite proves is the wiring a model sees — that `review`
 * reads the contract's command, runs it before anything is written, and hands the store a result
 * (or refuses with a sentence that names the command). It is its own suite because
 * `extensions/board/signs.test.ts` is at the 400-line bar and a suite that is named in
 * `test/suite-sizes.test.ts` may not gain a line.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
	agreed,
	bench,
	claimedWithContract,
	flushFixture,
	LEAD,
	NOW,
	runner,
	type Sent,
	type Session,
	signBus,
	signPlan as writePlan,
} from "../../test/helpers/board-signs.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { ENV_ROOT } from "../../lib/env.ts";

afterAll(flushFixture);

/** The command a card's contract names in these cases, and its one run. */
const VERIFY = "bun run check";

/** A card in `execute` whose contract names `verify`, or one that names no command. */
async function running(who: { lead: Session; peer: Session }, verify?: string): Promise<void> {
	await claimedWithContract(who);
	if (verify !== undefined) {
		await agreed(who.peer.call({ action: "contract", card: "1", path: await writePlan(who.peer), verify }));
	}
	// The lead signs the wording, then the holder moves it: the gates a run sits behind.
	await agreed(who.lead.call({ action: "approve", card: "1" }));
	await agreed(who.peer.call({ action: "move", card: "1", lane: "execute" }));
}

describe("a spot-check whose contract names a command", () => {
	test("runs it, and the exit and the commit ride the sign", async () => {
		const run = runner();
		const who = bench({ verify: run });
		await running(who, VERIFY);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		expect(reviewed.isError).toBeFalsy();
		expect(run.ran).toEqual([VERIFY]);
		// The record is the run's — the command, its exit, its moment, and the tree it ran in —
		// and the card is what the store ended up with.
		const root = (await who.lead.board.runtime.store(who.lead.board.ctx.cwd)).root();
		expect(reviewed.details.card?.review?.verified).toEqual({ cmd: VERIFY, exit: 0, at: NOW, root });
		expect(reviewed.details.card?.review?.by).toBe(LEAD);
	});

	test("a card whose contract names no command is refused the write, and nothing runs", async () => {
		// The fourth line is required, so an empty command is a line the contract owes rather than a way
		// to take it off — and the run seam is never reached, which is what this case holds.
		const run = runner();
		const who = bench({ verify: run });
		await claimedWithContract(who);
		const refused = await who.peer.call({
			action: "contract",
			card: "1",
			path: await writePlan(who.peer),
			verify: "",
		});
		expect(resultText(refused)).toContain("verify is required.");
		expect(run.ran).toEqual([]);
	});

	test("a red command refuses the sign, naming the exit and what it printed", async () => {
		const who = bench({ verify: runner({ exit: 1, output: "3 tests failed\n  see above" }) });
		await running(who, VERIFY);
		const refused = await who.lead.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain(`\`${VERIFY}\` exited 1`);
		expect(resultText(refused)).toContain("3 tests failed see above");
		// Nothing was signed: a red check is the gate working, not a failed call on a card.
		expect(refused.details.card?.review).toBeUndefined();
	});

	test("a run that outlives its bound is refused, naming the bound", async () => {
		const who = bench({ verify: runner({ killed: true, exit: -1 }) });
		await running(who, VERIFY);
		const refused = await who.lead.call({ action: "review", card: "1" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("did not finish within 10 minutes");
	});

	test("the run is what done reads: a note after it refuses the close", async () => {
		const who = bench({ verify: runner() });
		await running(who, VERIFY);
		expect((await who.lead.call({ action: "review", card: "1" })).isError).toBeFalsy();
		// A write after the sign: the bench's clock is fixed, so the later moment is the store's.
		const store = await who.peer.board.runtime.store(who.peer.board.ctx.cwd);
		const me = await who.peer.board.runtime.who(who.peer.board.ctx, who.peer.board.ctx.cwd);
		expect((await store.mutate("1", { kind: "note", text: "one more thing" }, me, NOW + 1)).ok).toBe(true);
		const refused = await who.peer.call({ action: "move", card: "1", lane: "done" });
		expect(refused.isError).toBe(true);
		expect(resultText(refused)).toContain("was written after its spot-check");
	});

	test("a run that outlives its start is stamped at the moment it was recorded", async () => {
		// The clock a spot-check's command spends: the call starts at `NOW` and the run pushes it on,
		// which is what a ten-minute bound looks like from the door's side.
		const clock = { at: NOW };
		const ran = runner();
		const slow = async (command: string, cwd: string) => {
			const outcome = await ran(command, cwd);
			clock.at += 5_000;
			return outcome;
		};
		const sent: Sent[] = [];
		const who = bench({ verify: slow, notify: signBus({ sent }) }, { clock: () => clock.at });
		await running(who, VERIFY);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		expect(reviewed.isError).toBeFalsy();
		expect(ran.ran).toEqual([VERIFY]);
		// Three moments, one fact: the sign, the record that its owner was told, and the field the
		// `done` gate reads. A reading taken at the top of the call would put the first two five
		// seconds behind the evidence they carry, and make `signStale` compare a stale half.
		expect(reviewed.details.card?.review?.at).toBe(NOW + 5_000);
		expect(reviewed.details.card?.review?.told?.at).toBe(NOW + 5_000);
		expect(reviewed.details.card?.updatedAt).toBe(NOW + 5_000);
	});

	test("at the root, the sign records the tree it ran in and says so", async () => {
		// The ordinary reviewer: no worktree, so the board's tree is the checkout, and the line a
		// reader sees names it rather than leaving the sha to stand for a place.
		const run = runner();
		const who = bench({ verify: run });
		await running(who, VERIFY);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		const root = (await who.lead.board.runtime.store(who.lead.board.ctx.cwd)).root();
		expect(run.cwds).toEqual([root]);
		expect(reviewed.details.card?.review?.verified?.root).toBe(root);
		// The bench has no git, so there is no commit: the tree is still the one it ran in.
		expect(reviewed.details.card?.review?.verified?.sha).toBeUndefined();
		expect(resultText(reviewed)).toContain(`ran \`${VERIFY}\` in ${root} (exit 0)`);
	});

	test("inside a worktree, the run, the commit, and the record are the worktree's", async () => {
		// The bug the card was filed for: the reviewer's session cwd stays the checkout, so both
		// the run and the sha used to be `main`'s while the work sat on a branch. The card is set up
		// before the move on purpose — a session enters a worktree mid-task, and the board's store was
		// opened over the checkout by then.
		const { who, run, worktree } = worktreeBench();
		await running(who, VERIFY);
		const reviewed = await withEnv({ [ENV_ROOT]: worktree }, () => who.lead.call({ action: "review", card: "1" }));
		// Compared as resolved paths: the temp root is a symlink on macOS, so the spelling the
		// environment carries and the one git prints are not the same string.
		expect(run.cwds.map((cwd) => realpathSync.native(cwd))).toEqual([realpathSync.native(worktree)]);
		expect(reviewed.details.card?.review?.verified).toEqual({
			cmd: VERIFY,
			exit: 0,
			at: NOW,
			root: worktree,
			sha: WORKTREE_SHA,
			branch: "worktree-gate",
		});
		// The worktree shares the checkout's git directory, and is not where that directory's parent is:
		// the record says which tree it was by naming a branch, and claims no checkout at all.
		expect(reviewed.details.card?.review?.verified?.checkout).toBeUndefined();
		// And the checkout's commit is nowhere in the record.
		expect(reviewed.details.card?.review?.verified?.sha).not.toBe(CHECKOUT_SHA);
	});

	test("in the checkout, the record says so, because a path does not", async () => {
		// The other half, and the one 48 of this board's own 54 runs landed on: the same review, taken
		// where the work lands instead of where it was made, now says which tree that was.
		const { who, run, main } = worktreeBench();
		await running(who, VERIFY);
		const reviewed = await who.lead.call({ action: "review", card: "1" });
		expect(run.cwds.map((cwd) => realpathSync.native(cwd))).toEqual([realpathSync.native(main)]);
		expect(reviewed.details.card?.review?.verified).toEqual({
			cmd: VERIFY,
			exit: 0,
			at: NOW,
			root: main,
			sha: CHECKOUT_SHA,
			branch: "main",
			checkout: true,
		});
	});
});

/**
 * The same bench, standing for one repository with a branch checked out in a worktree.
 *
 * The git answers are the seam this suite already fakes: `--show-toplevel` is the directory the
 * call was made from, the common directory is the checkout's, and `HEAD` differs between the two
 * trees — which is the fact the bug got wrong when the run used the session's cwd.
 */
function worktreeBench(): {
	who: { lead: Session; peer: Session };
	run: ReturnType<typeof runner>;
	main: string;
	worktree: string;
} {
	const temps = makeTempTracker();
	const run = runner();
	const main = temps.track(tempDir("pi-repo-"));
	const worktree = temps.track(tempDir("pi-wt-"));
	const common = join(main, ".git");
	/** The branch each tree has checked out; a checkout's own name is the project's to choose. */
	const branchOf = (cwd: string): string => (cwd === worktree ? "worktree-gate" : "main");
	const exec: NonNullable<Parameters<typeof bench>[1]>["exec"] = async (_command, args, options) => {
		const cwd = options?.cwd ?? main;
		if (args.includes("--git-common-dir")) return { stdout: `${common}\n`, stderr: "", code: 0 };
		// Before the `HEAD` answer below, which would otherwise answer the branch question with a sha.
		if (args.includes("--abbrev-ref")) return { stdout: `${branchOf(cwd)}\n`, stderr: "", code: 0 };
		if (args.includes("HEAD"))
			return { stdout: `${cwd === worktree ? WORKTREE_SHA : CHECKOUT_SHA}\n`, stderr: "", code: 0 };
		if (args.includes("--show-toplevel")) return { stdout: `${cwd}\n`, stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 1 };
	};
	return { who: bench({ verify: run }, { exec, cwd: main }), run, main, worktree };
}

/** The two commits the fake git answers with, so a case can tell one tree from the other. */
const CHECKOUT_SHA = "b59cf427";
const WORKTREE_SHA = "6c1e9a02";
