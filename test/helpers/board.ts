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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SHARED_CONFIG_FILE } from "../../lib/config.ts";
import { openBoardSession, type BoardSession } from "../../lib/board/session.ts";
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
	 * A suite that signs goes through the whole read path — the file, `readBoardConfig`, the
	 * store's cache — rather than handing `createStore` a config, which is the seam the page's
	 * suites use when they build a store by hand.
	 */
	lead?: string;
	/** The clock every call sees. */
	now?: number;
	/** The suite's temp tracker, so a directory this creates is cleaned up. */
	track?: <T extends string | undefined>(dir: T) => T;
	/** Override `exec`, for a case whose directory is a real repository. */
	exec?: FakePiOptions["exec"];
}

/** One board: the host, its session runtime, and the context a call is made with. */
export function boardHarness(options: BoardHarnessOptions = {}) {
	const track = options.track ?? ((dir) => dir);
	const agentDir = options.agentDir ?? track(tempDir("pi-agent-"));
	const cwd = options.cwd ?? track(tempDir("pi-repo-"));
	const now = options.now ?? 50_000;
	// Written before the session opens its store, because the settings are read once, when it
	// does: a suite that names a lead is the one that can sign through the tool.
	if (options.lead !== undefined) {
		mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), JSON.stringify({ board: { lead: options.lead } }));
	}
	// No git answers by default, so the directory keys on itself: the fallback every
	// non-repository session takes, and one less subprocess per case. A case that needs a
	// repository (a move to done records its commit) passes `exec`.
	const fake = createFakePi({ exec: options.exec ?? (async () => ({ stdout: "", stderr: "", code: 1 })) });
	const runtime = openBoardSession(fake.pi, { now: () => now, agentDir });
	const { ctx, notifications } = fakeCtx({
		cwd,
		sessionId: options.sessionId ?? "s-lead",
		sessionName: options.sessionName ?? "billing-lead",
	});
	return { fake, runtime, ctx, notifications, cwd, agentDir, now };
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
		planDir: async () => {
			throw new Error("the factory must not read the plan store");
		},
		serving: () => undefined,
		serve: () => {},
		team: { last: () => undefined, record: () => {} },
	};
}
