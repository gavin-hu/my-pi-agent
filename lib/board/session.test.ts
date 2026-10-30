/**
 * The board session: which store a call uses, who it writes as, and where it stands.
 *
 * The store cache is the interesting part — one open per working directory, so a
 * second call does not shell out to git again — and the identity is the pair a card
 * records: the session id, and the name the team already addresses it by.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { repoKeyOf } from "../repo-key.ts";
import { createStore } from "./store.ts";
import { busDirFor, openBoardSession } from "./session.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 42_000;

/** A pi whose git calls fail, so a directory keys on itself. */
function offlinePi() {
	return createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
}

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

/** A runtime with a temp agent directory and a fixed clock. */
function runtimeFor(agentDir: string) {
	return openBoardSession(offlinePi().pi, { now: () => NOW, agentDir });
}

/**
 * A record on this repository's bus, written where `readRoster` reads it.
 *
 * The label a session writes as comes from here, so a case about a name a person chose
 * has to put the record on the bus first — an empty directory is "no record".
 */
async function recordOnBus(
	runtime: ReturnType<typeof runtimeFor>,
	cwd: string,
	record: { id: string; label: string },
): Promise<void> {
	const dir = join(await runtime.busDir(cwd), "sessions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${record.id}.json`), JSON.stringify({ ...record, mode: "tui", lastSeen: NOW }));
}

describe("who", () => {
	const agentDir = temps.track(tempDir("pi-agent-"));

	test("names the session for the team from its id, not from the user's own name", async () => {
		const runtime = runtimeFor(agentDir);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1", sessionName: "billing-core" });
		// Pi's session name is the user's, and a rename must not move a card's owner: the id
		// is what the team addresses, and no bus record has claimed a name yet.
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "team-agent-s1" });
	});

	test("writes as the label the bus already holds for this session", async () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		// `/team join core-claims` names the session on the bus, so its cards, its notes, and
		// the join a claim makes are all that one word rather than a name derived past it.
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "core-claims" });
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "core-claims" });
	});

	test("keeps its derived name when the record is somebody else's, or blank", async () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		await recordOnBus(runtime, "/repo/billing", { id: "s-2", label: "core-claims" });
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("team-agent-s1");
		// A label is text from a file, so it is flattened and capped like any other: an empty
		// one falls back to the name the id answers to instead of leaving a blank chip.
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "" });
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("team-agent-s1");
	});

	test("names it as the seat while it serves the page, and as itself again after", async () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "core-claims" });
		expect(runtime.serving()).toBeUndefined();
		runtime.serve("team-lead");
		expect(runtime.serving()).toBe("team-lead");
		// The page a session serves is a role, so it outranks the name the team gave it.
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "team-lead" });
		runtime.serve(undefined);
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("core-claims");
	});

	test("keeps the readable chain for a host that reports no id", async () => {
		const runtime = runtimeFor(agentDir);
		const named = fakeCtx({ cwd: "/repo/billing", sessionId: "", sessionName: "billing-core" });
		expect((await runtime.who(named.ctx, "/repo/billing")).label).toBe("billing-core");
		const anonymous = fakeCtx({ cwd: "/repo/billing", sessionId: "" });
		const who = await runtime.who(anonymous.ctx, "/repo/billing");
		expect(who.id).toBeUndefined();
		expect(who.label).toBe("billing");
	});
});

describe("team", () => {
	test("has no standing until something asks for one", () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		expect(runtime.team.last()).toBeUndefined();
	});

	test("keeps the label and whether mail will reach the session", () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		runtime.team.record({ ok: true, label: "team-agent-s1", watching: { armed: true, wake: false } });
		expect(runtime.team.last()).toMatchObject({ ok: true, label: "team-agent-s1" });
	});

	test("keeps a failure, so a line can say why, and a later attempt replaces it", () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
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
		const runtime = runtimeFor(agentDir);
		const first = await runtime.store("/repo/billing");
		const second = await runtime.store("/repo/billing");
		expect(second).toBe(first);
	});

	test("files a repository-less directory under the agent directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = runtimeFor(agentDir);
		const store = await runtime.store(cwd);
		expect(store.dir.startsWith(join(agentDir, "board"))).toBe(true);
	});

	test("files two directories separately", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = runtimeFor(agentDir);
		const one = await runtime.store(temps.track(tempDir("pi-cwd-")));
		const other = await runtime.store(temps.track(tempDir("pi-cwd-")));
		expect(one.dir).not.toBe(other.dir);
	});
});

describe("busDir", () => {
	test("names the bus directory beside the board's, keyed by the same repository", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const cwd = temps.track(tempDir("pi-cwd-"));
		const runtime = runtimeFor(agentDir);
		const store = await runtime.store(cwd);
		// The bus keys on the same repository key the board used, so the two never drift.
		expect(await runtime.busDir(cwd)).toBe(join(agentDir, "session-bus", store.key));
	});

	test("follows the store's key, not the last segment of the board's own directory", () => {
		// The discriminating case: a board whose directory is called something else entirely.
		// A key read back off the path — the old `basename(store.dir)` — would put the roster
		// in `<agent-dir>/session-bus/<that directory's name>`, where no bus ever writes, and
		// every peer would read as no record instead of the page failing where someone would
		// notice.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const store = createStore(temps.track(tempDir("board-")), { key: "0123456789ab" });
		expect(busDirFor(agentDir, store)).toBe(join(agentDir, "session-bus", "0123456789ab"));
	});

	test("resolves once per working directory", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = runtimeFor(agentDir);
		const first = runtime.busDir("/repo/billing");
		expect(runtime.busDir("/repo/billing")).toBe(first);
		await first;
	});
});

describe("planDir", () => {
	test("names the plan store keyed by the same repository the board filed itself under", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const repo = temps.track(tempDir("pi-repo-"));
		const runtime = openBoardSession(repoPi(repo).pi, { now: () => NOW, agentDir });
		expect(await runtime.planDir(repo)).toBe(join(agentDir, "plans", repoKeyOf(join(repo, ".git"))));
	});

	test("keeps the unkeyed store for a directory outside a repository", async () => {
		// The branch a copy gets wrong: the board is always keyed, plans are not.
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = runtimeFor(agentDir);
		expect(await runtime.planDir("/repo/billing")).toBe(join(agentDir, "plans"));
	});

	test("resolves once per working directory", async () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		const first = runtime.planDir("/repo/billing");
		expect(runtime.planDir("/repo/billing")).toBe(first);
		await first;
	});
});

describe("now", () => {
	test("is the injected clock", () => {
		const runtime = runtimeFor(temps.track(tempDir("pi-agent-")));
		expect(runtime.now()).toBe(NOW);
	});
});
