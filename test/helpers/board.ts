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

import { openBoardSession } from "../../lib/board/session.ts";
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
