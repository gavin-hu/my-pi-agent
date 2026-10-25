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
 * A missing directory is an answer, not an error: it means no session has ever
 * joined this repository, and a caller renders that differently from an empty bus.
 *
 * Pure I/O, no state: one read answers one caller, and nothing is cached — a
 * heartbeat is ten seconds old at most, and the caller polls on its own clock.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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
}

/** Whether a record's heartbeat is fresh enough to call the session live. */
export function rosterStateOf(session: RosterSession, now: number, ttlMs = SESSION_TTL_MS): "live" | "quiet" {
	return now - session.lastSeen <= ttlMs ? "live" : "quiet";
}

/** The fields this reader trusts; anything else in the file is the bus's business. */
interface SessionPayload {
	id: string;
	label: string;
	mode: string;
	lastSeen: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
	if (typeof value !== "object" || value === null) return false;
	const { id, label, mode, lastSeen } = value as Record<string, unknown>;
	return (
		typeof id === "string" && typeof label === "string" && typeof mode === "string" && typeof lastSeen === "number"
	);
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
		sessions.push({ id, label, mode, lastSeen, mail: await mailCount(dir, name.slice(0, -".json".length)) });
	}
	return sessions.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
