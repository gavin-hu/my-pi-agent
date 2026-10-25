/**
 * Who is on this repository's session bus, read as data.
 *
 * The Team tab lists teammates, and `session-bus` owns those records. Neither
 * extension may import the other, and the board must keep working when the bus is
 * not loaded — so the records are read where the bus already put them,
 * `<agentDir>/session-bus/<repo-key>/`, as files rather than through its code. The
 * directory names, the record fields this reader trusts, and the liveness rule live
 * here once, and `session-bus` imports them, so a layout change cannot land in one
 * copy and not the other.
 *
 * The rule answers three things, not two: a record whose process is gone is `gone` at
 * once, rather than aging into `quiet` for ten minutes while the paths it claimed stay
 * held and the cards it held read `idle`.
 *
 * A missing directory is an answer, not an error: it means no session has ever
 * joined this repository, and a caller renders that differently from an empty bus.
 *
 * Pure I/O, no state: one read answers one caller, and nothing is cached — a
 * heartbeat is ten seconds old at most, and the caller polls on its own clock.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPidAlive, type LivenessFn, startTokenOf, type StartTokenFn } from "./spawn.ts";

/** The bus directory under the agent dir, `session-bus`. */
export const BUS_DIR_NAME = "session-bus";
/** One file per session inside it. */
export const SESSIONS_DIR_NAME = "sessions";
/** One directory per session, holding its mail. */
export const INBOX_DIR_NAME = "inbox";
/** How long a record's heartbeat stays believable: the rule the bus prunes by. */
export const SESSION_TTL_MS = 10 * 60_000;

/** One session as the page shows it. The rest of the record stays on disk. */
export interface RosterSession {
	id: string;
	label: string;
	mode: string;
	/** When the session last proved it was alive. */
	lastSeen: number;
	/** Messages waiting in its inbox. */
	mail: number;
	/**
	 * The process that owns the record, when the record names one.
	 *
	 * Absent is "cannot tell": a record written before this existed, or by a mode that
	 * is not a local process, is judged by its heartbeat alone rather than being called
	 * dead on no evidence.
	 */
	pid?: number;
	/** That process's start time, as the bus wrote it, when the record carries it. */
	startToken?: string;
	/**
	 * Whether the session is listening for mail, when its record says.
	 *
	 * Absent is "not listening": a record written before this existed and a session that
	 * stopped listening read the same way, so a reader never claims a peer will be reached.
	 */
	watching?: { armed: boolean; wake: boolean };
}

/** What a record's heartbeat and its process say together. */
export type RosterState = "live" | "quiet" | "gone";

/**
 * The host facts {@link rosterStateOf} reads, injectable so every branch is testable.
 *
 * The token spawns a process, so it is asked for only where liveness cannot decide.
 */
export interface RosterSeams {
	alive?: LivenessFn;
	token?: StartTokenFn;
}

/**
 * What one record says about its session: alive, aged out, or attached to nothing.
 *
 * Three answers, in the order they are decided:
 *
 * - `gone` — the record names a process and that process is not running. A heartbeat
 *   written ten seconds before a crash is not evidence the process exists, so death
 *   outranks a fresh one.
 * - `live` — the heartbeat is fresh. When the pid is alive too, the start token has not
 *   been asked for yet: a session that wrote ten seconds ago is not the interesting
 *   case for pid reuse, and `ps` costs a process.
 * - `quiet` — the heartbeat has aged. If the pid is alive but its start time is not the
 *   one the record wrote, the process is somebody else's and the session is `gone`
 *   after all; a platform that cannot answer the start time leaves it at `quiet`.
 */
export function rosterStateOf(
	session: RosterSession,
	now: number,
	ttlMs = SESSION_TTL_MS,
	seams: RosterSeams = {},
): RosterState {
	const alive = seams.alive ?? isPidAlive;
	if (session.pid !== undefined && !alive(session.pid)) return "gone";
	if (now - session.lastSeen <= ttlMs) return "live";
	if (session.pid !== undefined && session.startToken !== undefined) {
		const current = (seams.token ?? startTokenOf)(session.pid);
		if (current !== undefined && current !== session.startToken) return "gone";
	}
	return "quiet";
}

/** The fields this reader trusts; anything else in the file is the bus's business. */
interface SessionPayload {
	id: string;
	label: string;
	mode: string;
	lastSeen: number;
}

/** A record's pid, read only when it is the shape a pid has. */
function pidOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isSessionPayload(value: unknown): value is SessionPayload {
	if (typeof value !== "object" || value === null) return false;
	const { id, label, mode, lastSeen } = value as Record<string, unknown>;
	return (
		typeof id === "string" && typeof label === "string" && typeof mode === "string" && typeof lastSeen === "number"
	);
}

/**
 * The listening field, read only when it is the shape the bus writes.
 *
 * A malformed field is not a reason to hide a teammate: the row still draws, and the
 * only thing lost is the claim that mail will reach it. Exported because the field is
 * the record's, and `lib/session-tool.ts` reads the same one over the tool rather than
 * over the files — one reader for one shape.
 */
export function watchingOf(value: unknown): { armed: boolean; wake: boolean } | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { armed, wake } = value as Record<string, unknown>;
	return typeof armed === "boolean" && typeof wake === "boolean" ? { armed, wake } : undefined;
}

/** A record's start token, read only when it is a string with something in it. */
function startTokenIn(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** How many message files one session's inbox holds. A missing inbox is empty. */
async function mailCount(dir: string, stem: string): Promise<number> {
	try {
		const entries = await readdir(join(dir, INBOX_DIR_NAME, stem));
		return entries.filter((name) => name.endsWith(".json")).length;
	} catch {
		return 0;
	}
}

/**
 * Every session the bus has recorded for one repository, or `undefined` when the bus
 * has never been used here.
 *
 * One file that does not parse is skipped rather than thrown: a roster with three
 * good sessions is worth more than an error about the fourth.
 */
export async function readRoster(dir: string): Promise<RosterSession[] | undefined> {
	let names: string[];
	try {
		names = await readdir(join(dir, SESSIONS_DIR_NAME));
	} catch {
		return undefined;
	}
	const sessions: RosterSession[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(join(dir, SESSIONS_DIR_NAME, name), "utf-8"));
		} catch {
			continue;
		}
		if (!isSessionPayload(parsed)) continue;
		const { id, label, mode, lastSeen } = parsed;
		const watching = watchingOf((parsed as { watching?: unknown }).watching);
		const pid = pidOf((parsed as { pid?: unknown }).pid);
		const token = startTokenIn((parsed as { startToken?: unknown }).startToken);
		sessions.push({
			id,
			label,
			mode,
			lastSeen,
			mail: await mailCount(dir, name.slice(0, -".json".length)),
			...(pid === undefined ? {} : { pid }),
			...(token === undefined ? {} : { startToken: token }),
			...(watching === undefined ? {} : { watching }),
		});
	}
	return sessions.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
