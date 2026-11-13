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
import { openBoardSession, type BoardSession } from "../../lib/board/session.ts";
import type { Claims } from "../../lib/board/claims.ts";
import { BOARD_DIR_NAME } from "../../lib/board/store.ts";
import { registerTools } from "../../extensions/board/tools.ts";
import type { BoardDetails } from "../../extensions/board/types.ts";
import type { VerifyRun } from "../../lib/board/verify.ts";
import { fakeCtx } from "./context.ts";
import { createFakePi, type FakePiOptions } from "./fakes.ts";
import { tempDir } from "./env.ts";

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
	 * Whether the fixture states a project document at all.
	 *
	 * `false` leaves the directory bare, which is what a case about a command writing the file
	 * for the first time needs; the default states the team, so a sign can land.
	 */
	project?: boolean;
	/** The clock every call sees. */
	now?: number;
	/**
	 * A clock that moves, for a case about the moment a record carries: `now` is one reading for the
	 * whole case, and a spot-check's run is exactly the work that makes the two differ.
	 */
	clock?: () => number;
	/** The suite's temp tracker, so a directory this creates is cleaned up. */
	track?: <T extends string | undefined>(dir: T) => T;
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
	// does: a suite that names a lead is the one that can sign through the tool. A project names
	// its own team now, so the fixture states one — the session's own name unless a case says
	// otherwise — rather than relying on a built-in default the loaders no longer have.
	if (options.project !== false) {
		const lead = options.lead ?? agentLabel(options.sessionId ?? "s-lead");
		mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(
			join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE),
			JSON.stringify({ team: { lead, teammates: [lead] } }),
		);
	}
	// No git answers by default, so the directory keys on itself: the fallback every
	// non-repository session takes, and one less subprocess per case. A case that needs a
	// repository (a move to done records its commit) passes `exec`.
	const fake = createFakePi({ exec: options.exec ?? (async () => ({ stdout: "", stderr: "", code: 1 })) });
	const runtime = openBoardSession(
		fake.pi,
		options.claims === undefined
			? { now: options.clock ?? (() => now), agentDir }
			: { now: options.clock ?? (() => now), agentDir, claims: options.claims },
	);
	const { ctx, notifications } = fakeCtx({
		cwd,
		sessionId: options.sessionId ?? "s-lead",
		sessionName: options.sessionName ?? "billing-lead",
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
 * The card file the store wrote for `id`, found by reading the pile rather than by
 * rebuilding its file name: the padding is the store's, and a suite that guessed it would
 * keep passing on the day the naming changed under it.
 *
 * A suite that needs a record the gates never write — a card closed outside them — is
 * pointed at its file by this.
 */
export function cardFile(agentDir: string, id: string): string {
	const pile = join(agentDir, BOARD_DIR_NAME);
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
		busDir: async () => {
			throw new Error("the factory must not read the bus");
		},
		roster: async () => {
			throw new Error("the factory must not read the bus");
		},
		holder: async () => {
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
