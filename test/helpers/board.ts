/**
 * A board in a temp repository: a fake host, an agent directory, a working
 * directory, and the session a call or a page works as.
 *
 * The tool's suites and the page's suites need the same fixture — the same store, the
 * same session id and label — because a card claimed in one has to be the card the
 * other sees. Two copies of it are how the two suites drift onto different sessions
 * and quietly test different boards.
 *
 * Temp directories are the caller's to clean up: `boardHarness` takes a `track`
 * function, so each suite flushes them with the tracker it already owns.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SHARED_CONFIG_FILE } from "../../lib/config.ts";
import { agentLabel } from "../../lib/session-label.ts";
import { openBoardSession, type BoardSession } from "../../lib/workflow/session.ts";
import type { Claims } from "../../lib/workflow/claims.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { MAX_WIP } from "../../lib/workflow/limits.ts";
import board from "../../extensions/board/index.ts";
import { registerTools } from "../../extensions/board/tools.ts";
import type { BoardDetails } from "../../extensions/board/types.ts";
import type { VerifyRun } from "../../lib/workflow/verify.ts";
import { fakeCtx } from "./context.ts";
import { createFakePi, type FakePiOptions } from "./fakes.ts";
import { tempDir, withEnv } from "./env.ts";

/** What a suite may vary about the board it is given. */
export interface BoardHarnessOptions {
	/** A working directory to reuse, so two harnesses share one board. */
	cwd?: string;
	/** An agent directory to reuse, for the same reason. */
	agentDir?: string;
	/** The session this board is worked as. */
	sessionId?: string;
	sessionName?: string;
	/**
	 * The team name whose signature the two gates take, written to `<cwd>/.pi/bytefly.json`.
	 *
	 * A suite that signs goes through the whole read path — the file, `readTeamConfig`, the
	 * store's cache — rather than handing `createStore` a config, which is the seam the page's
	 * suites use when they build a store by hand. Omitted, the session working the board is the
	 * lead, under the name its own id derives.
	 */
	lead?: string;
	/**
	 * The names the fixture states as its team, beside the lead.
	 *
	 * The default is the lead alone, which can give a session nothing: a session may not draw the
	 * lead's own name, so a suite that expects the id-derived label states the lead only and keeps
	 * the loader's default roster out of it. A case about the draw states the free name it wants
	 * the session to take.
	 */
	teammates?: readonly string[];
	/**
	 * Whether the fixture states a project document at all.
	 *
	 * `false` leaves the directory bare, which is what a case about a command writing the file
	 * for the first time needs; the default states the team, so a sign can land.
	 */
	project?: boolean;
	/** The clock every call sees. */
	now?: number;
	/**
	 * The branch the session's `ctx` reports, so a case can dress the session's mode.
	 *
	 * `lead` mode rides a custom entry on the branch (`lib/mode-state.ts`), and `who()` reads it to
	 * answer `Actor.seat` — so a case about the seat has to hand in the branch a real session would.
	 * Defaults to today's empty branch, so no existing case changes answer.
	 */
	branch?: unknown[];
	/**
	 * A clock that moves, for a case about the moment a record carries: `now` is one reading for the
	 * whole case, and a spot-check's run is exactly the work that makes the two differ.
	 */
	clock?: () => number;
	/** The suite's temp tracker, so a directory this creates is cleaned up. */
	track?: <T extends string | undefined>(dir: T) => T;
	/**
	 * The process this session is worked from, for a case about a transcript reset.
	 *
	 * A `/new` keeps the bus record the process serves, so a session with a new id is only named by
	 * the row it left if the row's pid is the one it runs as (#915). Defaults to the real process.
	 */
	pid?: number;
	/**
	 * The `serve` section the project document states, beside the team.
	 *
	 * The page's tab is `serve.autoOpen`, so a case about a page that opens none states it here
	 * rather than writing a second document over the fixture's team.
	 */
	serve?: Record<string, unknown>;
	/** Override `exec`, for a case whose directory is a real repository. */
	exec?: FakePiOptions["exec"];
	/** Test seam: the bus a lane crossing writes to, so a suite records it without a bus. */
	claims?: Claims;
	/**
	 * Test seam: the run a spot-check makes.
	 *
	 * A contract names a command, so the tool's `review` runs one: this answers without starting a
	 * process, and a case about the run passes its own.
	 */
	verify?: VerifyRun;
}

/** One board: the host, its session runtime, and the context a call is made with. */
export function boardHarness(options: BoardHarnessOptions = {}) {
	const track = options.track ?? ((dir) => dir);
	const agentDir = options.agentDir ?? track(tempDir("pi-agent-"));
	const cwd = options.cwd ?? track(tempDir("pi-repo-"));
	const now = options.now ?? 50_000;
	// Written before the session opens its store, because the settings are read once, when it
	// does: a suite that names a lead is the one that can sign through the tool. The fixture states
	// the team it wants rather than leaving it to the loader's default roster, so an actor is the
	// name the case chose and not a name the default happened to give.
	if (options.project !== false) {
		const lead = options.lead ?? agentLabel(options.sessionId ?? "s-lead");
		mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(
			join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE),
			JSON.stringify({
				team: { lead, teammates: options.teammates ?? [lead] },
				board: { wip: { perOwner: MAX_WIP } },
				...(options.serve === undefined ? {} : { serve: options.serve }),
			}),
		);
	}
	// No git answers by default, so the directory keys on itself: the fallback every
	// non-repository session takes, and one less subprocess per case. A case that needs a
	// repository (a move to done records its commit) passes `exec`.
	const fake = createFakePi({ exec: options.exec ?? (async () => ({ stdout: "", stderr: "", code: 1 })) });
	const runtime = openBoardSession(fake.pi, {
		now: options.clock ?? (() => now),
		agentDir,
		...(options.claims === undefined ? {} : { claims: options.claims }),
		...(options.pid === undefined ? {} : { pid: options.pid }),
	});
	const { ctx, notifications } = fakeCtx({
		cwd,
		sessionId: options.sessionId ?? "s-lead",
		sessionName: options.sessionName ?? "billing-lead",
		...(options.branch === undefined ? {} : { branch: options.branch }),
	});
	return { fake, runtime, ctx, notifications, cwd, agentDir, now };
}

/**
 * A `board` result, as the details a suite reads rather than the rendered rows.
 *
 * The tool's `execute` answers `unknown`, and this names the guarantee a suite relies on:
 * the result is the one `tools.ts` builds, so a case may read `details` off it.
 */
export interface BoardToolResult {
	content: Array<{ text: string }>;
	details: BoardDetails;
}

/**
 * The `board` tool, registered on a board of its own, and the call a suite makes.
 *
 * One owner for the wiring, because two suites that each registered the tool would be two
 * fixtures that drift — the rule `test/shared-helpers.test.ts` enforces over test files.
 */
export function boardTool(options: BoardHarnessOptions = {}) {
	const board = boardHarness(options);
	registerTools(board.fake.pi, board.runtime, { verify: options.verify ?? passingRun });
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		board,
		async call(args: Record<string, unknown>): Promise<BoardToolResult> {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as BoardToolResult;
		},
	};
}

/**
 * A run that passed, for the suites whose subject is a gate rather than the command behind it.
 *
 * A spot-check of a card whose contract names a command runs that command: a fixture that did not
 * answer here would spawn `bun run check` from a unit test.
 */
const passingRun: VerifyRun = async () => ({ exit: 0, output: "", killed: false });

/**
 * One board with the factory registered over it, and the `tool_call` guard the host would call.
 *
 * The write gate and the plan-entry gate are questions about the *factory*, not the tool, so a
 * suite needs a board the factory is already guarding rather than one it calls the tool on. `claim`
 * decides whether the card is this session's — the default — or still in the pool, which is the
 * state a plan entry is refused in; `bus` registers a `session` tool so the board reads as a team's
 * board rather than a solo one.
 */
export async function guardedBoard(
	options: {
		/** The suite's temp tracker, so the directories this creates are cleaned up. */
		track?: <T extends string | undefined>(dir: T) => T;
		/** The branch the session reports, for a case about a mode. */
		branch?: unknown[];
		/** Whether the card is claimed before the guard is taken; a pool card is unclaimed. */
		claim?: boolean;
		/** Whether a bus is loaded, which is one of the two facts that decide who the board speaks for. */
		bus?: boolean;
	} = {},
) {
	return await withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, async () => {
		const harness = boardHarness({ track: options.track, branch: options.branch });
		const me = await harness.runtime.who(harness.ctx, harness.cwd);
		const store = await harness.runtime.store(harness.cwd);
		const card = await store.create(
			{ title: "A card in flight", paths: ["extensions/board/write-gate.ts"] },
			me,
			harness.now,
		);
		if (options.claim !== false) await store.mutate(card.id, { kind: "claim" }, me, harness.now);
		board(harness.fake.pi, { session: harness.runtime });
		if (options.bus === true) harness.fake.pi.tools.set("session", { name: "session" });
		const [guard] = harness.fake.pi.handlers.get("tool_call") ?? [];
		if (guard === undefined) throw new Error("the factory registered no tool_call handler");
		return {
			harness,
			card,
			call: async (toolName: string, input: unknown): Promise<{ block?: true; reason?: string } | undefined> =>
				(await guard({ toolName, input }, harness.ctx)) as { block?: true; reason?: string } | undefined,
		};
	});
}

/**
 * The card file the store wrote for `id`, found by reading the pile rather than by
 * rebuilding its file name: the padding is the store's, and a suite that guessed it would
 * keep passing on the day the naming changed under it.
 *
 * A suite that needs a record the gates never write — a card closed outside them — is
 * pointed at its file by this. The pile is found rather than spelled: a board is filed under
 * `repos/<id>/board/` now and was `<agent-dir>/board/<key>/` before, and a suite that pinned
 * either spelling would fail on the day the store moved — which is exactly this card.
 */
export function cardFile(agentDir: string, id: string): string {
	const pile = join(agentDir, "repos");
	const found = readdirSync(pile, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".json"))
		.find((name) => (JSON.parse(readFileSync(join(pile, name), "utf8")) as { id?: string }).id === id);
	if (found === undefined) throw new Error(`no card file for #${id} under ${pile}`);
	return join(pile, found);
}

/**
 * A session that never touches the disk: every read throws, so a factory that opens
 * one at registration fails the test that boots it rather than passing quietly.
 */
export function stubSession(): BoardSession {
	return {
		store: () => {
			throw new Error("the factory must not open a store");
		},
		who: async () => ({ label: "billing-lead" }),
		now: () => 0,
		// No identity: a stub answers for a machine that never joined a bus.
		host: async () => undefined,
		busDir: async () => {
			throw new Error("the factory must not read the bus");
		},
		roster: async () => {
			throw new Error("the factory must not read the bus");
		},
		bus: async () => {
			throw new Error("the factory must not read the bus");
		},
		holder: async () => {
			throw new Error("the factory must not read the bus");
		},
		holderLabel: async () => {
			throw new Error("the factory must not read the bus");
		},
		planDir: async () => {
			throw new Error("the factory must not read the plan store");
		},
		serving: () => undefined,
		serve: () => {},
		team: { last: () => undefined, record: () => {} },
		cross: async () => {
			throw new Error("the factory must not cross a lane");
		},
	};
}
