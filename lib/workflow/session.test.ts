/**
 * The board session: which store a call uses, who it writes as, and where it stands.
 *
 * The store cache is the interesting part — one open per working directory, so a
 * second call does not shell out to git again — and the identity is the pair a card
 * records: the session id, and the name the team already addresses it by.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { ENV_ROOT } from "../env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { billingCard } from "../../test/helpers/fixtures/board.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { NOW, offlinePi, openSession, recordOnBus } from "../../test/helpers/board-session.ts";
import { createStore, openBoard } from "./store.ts";
import { busDirFor, openBoardSession } from "./session.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A pi whose git calls report `root` as a repository's root and common dir. */
function repoPi(root: string) {
	return createFakePi({
		exec: async (_command, args) => {
			const line = args.join(" ");
			if (line.includes("--git-common-dir")) return { stdout: join(root, ".git"), stderr: "", code: 0 };
			if (line.includes("--show-toplevel")) return { stdout: root, stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		},
	});
}

describe("team", () => {
	test("has no standing until something asks for one", () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		expect(runtime.team.last()).toBeUndefined();
	});

	test("keeps the label and whether mail will reach the session", () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		runtime.team.record({ ok: true, label: "team-agent-s1", watching: { armed: true, wake: false } });
		expect(runtime.team.last()).toMatchObject({ ok: true, label: "team-agent-s1" });
	});

	test("keeps a failure, so a line can say why, and a later attempt replaces it", () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		runtime.team.record({ ok: false, error: "the session bus is not loaded" });
		// A failure is not "on the team": a caller reads `ok` to decide whether to ask again.
		expect(runtime.team.last()?.ok).toBe(false);
		runtime.team.record({ ok: true, label: "team-agent-s1", watching: { armed: true, wake: false } });
		expect(runtime.team.last()?.ok).toBe(true);
	});
});

describe("one session per host", () => {
	/** One host, and its agent directory, shared by two extensions' calls. */
	function sharedHost() {
		const fake = offlinePi();
		const agentDir = temps.track(tempDir("pi-agent-"));
		const options = { now: () => NOW, agentDir };
		return { fake, board: openBoardSession(fake.pi, options), team: openBoardSession(fake.pi, options) };
	}

	test("hands board and team one session, so the seat `/board` sets names both", async () => {
		const { board, team } = sharedHost();
		expect(team).toBe(board);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		board.serve("team-lead");
		// The regression: a second session kept its own seat, so `team` wrote every card as
		// `team-agent-s1` while `board` wrote the same session's cards as `team-lead`.
		expect(await team.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "team-lead" });
	});

	test("shares the standing, so a join through either door is the one status reads", () => {
		const { board, team } = sharedHost();
		team.team.record({ ok: true, label: "team-lead", watching: { armed: true, wake: false } });
		expect(board.team.last()).toMatchObject({ ok: true, label: "team-lead" });
	});

	test("keeps a second host's session separate", () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const options = { now: () => NOW, agentDir };
		const first = openBoardSession(offlinePi().pi, options);
		const second = openBoardSession(offlinePi().pi, options);
		expect(second).not.toBe(first);
		second.serve("team-lead");
		expect(first.serving()).toBeUndefined();
	});
});

describe("store", () => {
	test("opens one store per working directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		const first = await runtime.store("/repo/billing");
		const second = await runtime.store("/repo/billing");
		expect(second).toBe(first);
	});

	test("opens again when the active worktree root moves, so root() follows the environment", async () => {
		// The shape that broke a live close: the store is opened inside a worktree and keeps that root
		// for the session's life, while `worktreeRoot()` stops answering the moment the path is gone. The
		// key is the effective root, not the session cwd — which does not move as a worktree is left.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const worktree = temps.track(tempDir("pi-worktree-"));
		const runtime = openSession(agentDir);
		const inside = await withEnv({ [ENV_ROOT]: worktree }, () => runtime.store(cwd));
		expect(inside.root()).toBe(worktree);
		const back = await withEnv({ [ENV_ROOT]: undefined }, () => runtime.store(cwd));
		expect(back.root()).toBe(cwd);
		expect(back).not.toBe(inside);
	});

	test("asks again after an open that failed, instead of pinning the failure", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		let attempts = 0;
		const runtime = openBoardSession(offlinePi().pi, {
			now: () => NOW,
			agentDir,
			// The seam the failure needs: every step of a real open answers for itself, so a
			// transient failure cannot be made to happen through the filesystem.
			open: async (cwd) => {
				attempts += 1;
				if (attempts === 1) throw new Error("the config could not be read");
				return openBoard(offlinePi().pi, cwd, { agentDir });
			},
		});
		await expect(runtime.store("/repo/billing")).rejects.toThrow("the config could not be read");
		// The rule `lib/lazy.ts` keeps for a load it owns: one bad read is a moment, not a
		// session, so the next call asks again rather than replaying the rejection.
		const store = await runtime.store("/repo/billing");
		expect(attempts).toBe(2);
		// And what is remembered is the success: a further call opens nothing new.
		expect(await runtime.store("/repo/billing")).toBe(store);
		expect(attempts).toBe(2);
	});

	test("files a repository-less directory under a local- name in the agent directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = openSession(agentDir);
		const store = await runtime.store(cwd);
		expect(store.dir.startsWith(join(agentDir, "repos", "local-"))).toBe(true);
	});

	test("files two directories separately", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		const one = await runtime.store(temps.track(tempDir("pi-cwd-")));
		const other = await runtime.store(temps.track(tempDir("pi-cwd-")));
		expect(one.dir).not.toBe(other.dir);
	});
});

describe("busDir", () => {
	test("names the bus directory beside the board's, inside the repository's own directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = openSession(agentDir);
		const store = await runtime.store(cwd);
		// Siblings under `repos/<id>/`: the bus is derived from the store's own directory, so the
		// two cannot drift about which repository or which id they belong to.
		expect(await runtime.busDir(cwd)).toBe(join(dirname(store.dir), "session-bus"));
	});

	test("derives the bus from the store's directory, not from a key read off its name", async () => {
		// The discriminating case: a store whose directory name is nothing like its key. The bus
		// follows the directory it sits beside, so a store filed under an id and a bus filed under
		// that id agree whatever the key happens to be.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const store = createStore(temps.track(tempDir("board-")), { key: "0123456789ab" });
		expect(await busDirFor(agentDir, store)).toBe(join(dirname(store.dir), "session-bus"));
	});

	test("resolves once per working directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		const first = runtime.busDir("/repo/billing");
		expect(runtime.busDir("/repo/billing")).toBe(first);
		await first;
	});

	test("asks again after the store it is built on failed", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		let attempts = 0;
		const runtime = openBoardSession(offlinePi().pi, {
			now: () => NOW,
			agentDir,
			open: async (cwd) => {
				attempts += 1;
				if (attempts === 1) throw new Error("the store could not be opened");
				return openBoard(offlinePi().pi, cwd, { agentDir });
			},
		});
		await expect(runtime.busDir("/repo/billing")).rejects.toThrow("the store could not be opened");
		// The directory is the store's own, so the store's failure is this one's too — and the
		// retry has to reach both, or the roster stays a rejection for the whole session.
		expect(await runtime.busDir("/repo/billing")).toBe(
			join(dirname((await runtime.store("/repo/billing")).dir), "session-bus"),
		);
		expect(attempts).toBe(2);
	});
});

describe("holder", () => {
	/** A card held by a session the bus may or may not have recorded. */
	const heldBy = (id: string, label: string) => billingCard({ lane: "plan", owner: { id, label } });

	test("binds the bus's answer to the owner it was read for", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = openSession(agentDir);
		await recordOnBus(runtime, cwd, { id: "s-core", label: "billing-core" });
		const card = heldBy("s-core", "billing-core");
		expect(await runtime.holder(cwd, card)).toEqual({ owner: { id: "s-core", label: "billing-core" }, state: "live" });
	});

	test("answers absent for an owner the bus has recorded nobody under", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = openSession(agentDir);
		await recordOnBus(runtime, cwd, { id: "s-lead", label: "billing-lead" });
		const card = heldBy("s-core", "billing-core");
		expect(await runtime.holder(cwd, card)).toEqual({
			owner: { id: "s-core", label: "billing-core" },
			state: "absent",
		});
	});

	test("answers nothing for a board with no bus, and for a card nobody holds", async () => {
		// No bus is a question: a machine that has recorded nobody cannot say a session stopped.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = openSession(agentDir);
		expect(await runtime.holder(cwd, heldBy("s-core", "billing-core"))).toBeUndefined();
		expect(await runtime.holder(cwd, billingCard())).toBeUndefined();
	});

	test("a bus that cannot be read is a question rather than a stopped session", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openBoardSession(offlinePi().pi, {
			now: () => NOW,
			agentDir,
			open: async () => {
				throw new Error("the store could not be opened");
			},
		});
		expect(await runtime.holder("/repo/billing", heldBy("s-core", "billing-core"))).toBeUndefined();
	});
});

describe("planDir", () => {
	test("is the sibling of the board store this session resolved", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const repo = temps.track(tempDir("pi-repo-"));
		const runtime = openBoardSession(repoPi(repo).pi, { now: () => NOW, agentDir });
		// One repository's state is one directory (#771), so the plans are the sibling the `plan`
		// tool writes — not a second key resolved here that can drift from it (#789).
		expect(await runtime.planDir(repo)).toBe(join(dirname((await runtime.store(repo)).dir), "plans"));
	});

	test("files a directory outside a repository under the same identity as its board", async () => {
		// The branch a copy gets wrong: the flat store is the mover's spelling now, not this one's.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		const planDir = await runtime.planDir("/repo/billing");
		expect(planDir).toBe(join(dirname((await runtime.store("/repo/billing")).dir), "plans"));
		expect(dirname(dirname(planDir))).toBe(join(agentDir, "repos"));
	});

	test("resolves once per working directory", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		const first = runtime.planDir("/repo/billing");
		expect(runtime.planDir("/repo/billing")).toBe(first);
		await first;
	});
});

describe("now", () => {
	test("is the injected clock", () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		expect(runtime.now()).toBe(NOW);
	});
});
