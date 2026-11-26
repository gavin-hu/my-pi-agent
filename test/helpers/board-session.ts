/**
 * The session a board call is worked as, for the suites that ask who it writes as.
 *
 * `who` is asked by two suites now — the session's own order of answers, and the two rows a
 * transcript reset puts in front of it — so the double a case starts from lives here rather than in
 * both. The clock is one reading for the whole case, and the process is a parameter because a `/new`
 * is a fact about the process and not about the transcript.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePi } from "./fakes.ts";
import { tempDir } from "./env.ts";
import { writeBusRecord } from "./bus.ts";
import { type BoardSession, openBoardSession } from "../../lib/workflow/session.ts";

/** The clock every case in these suites reads. */
export const NOW = 42_000;

/** A pi whose git calls fail, so a directory keys on itself. */
export function offlinePi() {
	return createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
}

/** A runtime over a temp agent directory and a fixed clock; `pid` is the process a `/new` left. */
export function openSession(agentDir: string, pid?: number) {
	return openBoardSession(offlinePi().pi, { now: () => NOW, agentDir, ...(pid === undefined ? {} : { pid }) });
}

/** A repository whose project document states `names` as its team, led by `lead` when one is given. */
export function projectWithTeam(
	track: <T extends string | undefined>(dir: T) => T,
	names: readonly string[],
	lead?: string,
): string {
	const cwd = track(tempDir("pi-board-session-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "bytefly.json"),
		JSON.stringify({ team: { ...(lead === undefined ? {} : { lead }), teammates: names } }),
	);
	return cwd;
}

/**
 * A record on this repository's bus, written where `readRoster` reads it.
 *
 * The label a session writes as comes from here, so a case about a name a person chose has to put
 * the record on the bus first — an empty directory is "no record".
 */
export async function recordOnBus(
	runtime: BoardSession,
	cwd: string,
	record: { id: string; label: string; lastSeen?: number; pid?: number; host?: string },
): Promise<void> {
	const { lastSeen = NOW, ...rest } = record;
	writeBusRecord(await runtime.busDir(cwd), { ...rest, lastSeen });
}
