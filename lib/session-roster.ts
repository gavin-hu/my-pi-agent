/**
 * Who is on this repository's session bus, read as data.
 *
 * The Team tab lists teammates, and `session-bus` owns those records. Neither
 * extension may import the other, and the board must keep working when the bus is
 * not loaded — so the records are read where the bus already put them,
 * `<agent-dir>/session-bus/<repo-key>/`, as files rather than through its code. The
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
 * Two questions are asked of these records, and both are answered here because they are one
 * rule over one file. `presenceOf` reports what an owner is — live, quiet, gone, or absent from
 * a bus that has pruned it — which is what a card's lane depends on. `peerOf` addresses a name:
 * which record a message goes to, and what that record says about reading it. "Which record does
 * this name name" was answered three times before it lived here, once per caller, and the three
 * answers disagreed about a stopped record and about a label two sessions share.
 *
 * Pure I/O, no state: one read answers one caller, and nothing is cached — a
 * heartbeat is ten seconds old at most, and the caller polls on its own clock.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUS_DIR_NAME, INBOX_DIR_NAME, SESSIONS_DIR_NAME, storedName } from "./session-files.ts";
import { sameLabel } from "./session-label.ts";
import { isPidAlive, type LivenessFn, type StartTokenFn, startTokenOf } from "./spawn.ts";

/** How long a record's heartbeat stays believable: the rule the bus prunes by. */
export const SESSION_TTL_MS = 10 * 60_000;

/** One session as the page shows it. The rest of the record stays on disk. */
export interface RosterSession {
	id: string;
	label: string;
	mode: string;
	/** When the session last proved it was alive. */
	lastSeen: number;
	/** Messages waiting in its inbox that the record does not say it was told about. */
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
	 * When the session began the turn it is in, absent outside one.
	 *
	 * Only a stamp beside a fresh heartbeat is a session at work: the field is what the bus
	 * wrote on `agent_start`, and a process that died mid-turn left it behind.
	 */
	turnAt?: number;
	/**
	 * Whether the session is listening for mail, when its record says.
	 *
	 * `armed: false` is a session on the bus that no wake will reach; absent is only a record
	 * written before the field existed, so a reader never claims a peer will be reached.
	 */
	watching?: { armed: boolean; wake: boolean };
}

/** What a record's heartbeat and its process say together. */
export type RosterState = "live" | "quiet" | "gone";

/**
 * What a record's heartbeat and its process say together.
 *
 * The fields the rule reads, rather than the whole roster row: `session-bus` judges its
 * own records by the same rule without carrying a `mail` count it never shows.
 */
export type RosterFacts = Pick<RosterSession, "lastSeen" | "pid" | "startToken">;

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
	session: RosterFacts,
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

/** One record as addressing reads it: the identity, the name, and the two facts a result prints. */
export interface PeerRow {
	/** What mail is addressed with, and what a card records as the holder. */
	id: string;
	/** The name a person, a result, and a card's owner all use. */
	label: string;
	/**
	 * What its heartbeat and process say; absent when the caller cannot tell, which is not a death.
	 *
	 * `session-bus` answers it over its own records; `lib/session-tool.ts` reads the bus's own answer
	 * out of the status payload, where it has already been judged.
	 */
	state?: RosterState;
	/**
	 * Whether its watch will report mail at its next turn; absent when the record does not say.
	 *
	 * The bus's field is `watching.armed`, and `listening` is the word a result prints: the one
	 * bridge from the one to the other is {@link peerRowOf}, so a caller never flattens it itself.
	 */
	listening?: boolean;
}

/** One session record as addressing reads it: its liveness at `now`, and the watch it carries. */
export function peerRowOf(session: RosterSession, now: number): PeerRow {
	return {
		id: session.id,
		label: session.label,
		state: rosterStateOf(session, now),
		...(session.watching === undefined ? {} : { listening: session.watching.armed }),
	};
}

/** A name to address: the id a card or a caller kept, and the label it is spelled as. */
export interface PeerName {
	/** The session id, when the caller has one; a name a person typed is both fields. */
	id?: string;
	/** The label the name is spelled as. */
	label: string;
}

/**
 * The record a name reaches, by the one rule both extensions address mail with.
 *
 * Three steps, because an id is an identity and a label is a role:
 *
 * 1. the record with this id, when it is live — a live session named by its id is that session;
 * 2. the one live record whose label matches — exactly one, because two is the bus's ambiguity to
 *    name in its own sentence, and a caller that guessed would address one session's mail under
 *    another's name;
 * 3. the record with this id whatever its state, so a session that has stopped can be reported as
 *    stopped rather than as nobody. A caller that writes mail must read `state`: the bus writes no
 *    file for a record it calls gone.
 *
 * Nothing answers for a label no record holds, and nothing for a roster that cannot be read — which
 * is not "nobody is here". Each caller words its own fallback, because the fallbacks differ: a
 * card's own word, or the name the person typed.
 */
export function peerOf(rows: readonly PeerRow[] | undefined, name: PeerName): PeerRow | undefined {
	if (rows === undefined) return undefined;
	// Only a record that is gone is out of the running: an absent state is "cannot tell", and a quiet
	// one is still a session the bus writes a message file for.
	const live = rows.filter((row) => row.state !== "gone");
	const byId = name.id === undefined ? undefined : live.find((row) => row.id === name.id);
	if (byId !== undefined) return byId;
	const named = soleLabel(live, name.label);
	if (named !== undefined) return named;
	return name.id === undefined ? undefined : rows.find((row) => row.id === name.id);
}

/** The one live record whose label matches, or nothing when none or several do. */
function soleLabel(live: readonly PeerRow[], label: string): PeerRow | undefined {
	const matches = live.filter((row) => sameLabel(row.label, label));
	return matches.length === 1 ? matches[0] : undefined;
}

/**
 * A name a caller typed, which may be an id or a label and is not the caller's to decide.
 *
 * `team`'s verbs take one string from a person, and the bus tries it as an id and then as a label;
 * so does {@link peerOf} when both fields are handed the same spelling.
 */
export function peerNamed(rows: readonly PeerRow[] | undefined, name: string): PeerRow | undefined {
	const target = name.trim();
	return peerOf(rows, { id: target, label: target });
}

/** The one fact that keeps a peer from reading its mail now. */
export type PeerAlarm = "quiet" | "not-listening";

/**
 * What a peer's record says about reading mail now, or nothing when it says nothing is wrong.
 *
 * Two answers, decided in this order: a heartbeat past the bus's window says nothing is known to be
 * there, and that outranks the watch the record still carries, because a watch on a record that may
 * be dead is the weaker fact. An absent `listening` is not an accusation — a record written before
 * the field existed is not a session ignoring its mail. A record that stopped answers nothing: both
 * sentences promise the mail will be read later, and a process that is gone promises nothing, which
 * is why a caller that writes mail refuses `gone` outright instead of wording it.
 */
export function peerAlarm(peer: Pick<PeerRow, "state" | "listening">): PeerAlarm | undefined {
	if (peer.state === "quiet") return "quiet";
	if (peer.state === "gone") return undefined;
	return peer.listening === false ? "not-listening" : undefined;
}

/**
 * Why a peer with an alarm will not read this now, in the words every surface prints.
 *
 * Beside the rule that decides which alarm it is, because the two surfaces that print it — a sign's
 * line and the round's result — would otherwise be two copies of one sentence, and one of them
 * would end up telling a peer it is asleep.
 */
export const ALARM_REASON: Readonly<Record<PeerAlarm, string>> = {
	quiet: "nothing says it is still there",
	"not-listening": "it reads this at its next turn",
};

/**
 * What a reader knows about one session, where a label the bus never recorded is also an answer.
 *
 * `absent` is not a fourth liveness state: a record the bus has pruned, or a session that never
 * joined, says nothing about whether its process is running. It is the answer a caller needs to
 * tell "the bus holds no record of this label" from "this machine has no bus" (`undefined`).
 */
export type SessionPresence = RosterState | "absent";

/**
 * The labels among `labels` whose record carries `alarm`.
 *
 * A label the bus cannot answer for is left out — "the record does not say" is not "nobody will
 * read it" — and a quiet peer is left to its own alarm, because the louder fact outranks a watch
 * that is off. One body, so a result and the round cannot word one peer twice.
 */
export function peersWithAlarm(
	peers: readonly PeerRow[] | undefined,
	labels: readonly string[],
	alarm: PeerAlarm,
): string[] {
	if (peers === undefined) return [];
	return labels.filter((label) => {
		const peer = peerNamed(peers, label);
		return peer !== undefined && peerAlarm(peer) === alarm;
	});
}

/**
 * The roster row one owner names: the record with the card's id when it carries one, else the label
 * a card written before ids carries.
 *
 * An id with no record is `absent`; a label a later session took is not that session's record. The
 * id is what `holds` compares first, so liveness cannot let a reused name answer for a card it does
 * not own. The label branch is the one case with no id to compare — a record written before the
 * field, or a handoff the bus could not name — which is also where the label still addresses mail.
 */
function recordOf(roster: readonly RosterSession[], owner: { id?: string; label: string }): RosterSession | undefined {
	if (owner.id !== undefined) return roster.find((session) => session.id === owner.id);
	return roster.find((session) => sameLabel(session.label, owner.label));
}

/**
 * What the bus says about one owner, and the two absences kept apart.
 *
 * `undefined` is "this repository has no bus to ask": a machine that has recorded nobody cannot be
 * read as "that session is gone", and the answer has to stay a question. A roster that simply holds
 * no record of the owner is `absent` — the row a page draws for an owner nothing answers to — and an
 * owner that carries an id is answered by that record alone, so a reused label cannot stand in.
 */
export function presenceOf(
	roster: readonly RosterSession[] | undefined,
	owner: { id?: string; label: string },
	now: number,
): SessionPresence | undefined {
	if (roster === undefined) return undefined;
	const record = recordOf(roster, owner);
	return record === undefined ? "absent" : rosterStateOf(record, now);
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

/**
 * The mail ids the record says its session was told about, read only when they are ids.
 *
 * A malformed cursor costs the cursor and not the row, the rule `watchingOf` follows: a page must
 * still draw a teammate, and the most a bad field can do is count its mail as untold.
 */
function seenOf(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.every((id): id is string => typeof id === "string") ? value : undefined;
}

/**
 * How many files one session's inbox holds that `told` does not name. A missing inbox is empty.
 *
 * Counted from the names alone — a message id is its file name — so the Team tab's repaint every
 * second stays a directory read, exactly as it was before the record carried a cursor.
 */
async function mailCount(dir: string, name: string, told: ReadonlySet<string>): Promise<number> {
	try {
		const entries = await readdir(join(dir, INBOX_DIR_NAME, name));
		return entries.filter((entry) => entry.endsWith(".json") && !told.has(entry.slice(0, -".json".length))).length;
	} catch {
		return 0;
	}
}

/**
 * One session's own label, found by the id it belongs to.
 *
 * The record is filed under the repository's key, which a caller without a board store
 * would have to resolve with git first — and a footer asking for a name that may not
 * exist should not cost two subprocesses at every session start. So the bus root is
 * walked instead and the record is matched on its id: a session id belongs to one
 * session, so the first record that names it is the answer wherever the bus filed it.
 *
 * Every miss is ordinary: a machine with no bus, or with records for other sessions
 * only, answers `undefined` rather than an error.
 */
export async function readSessionLabel(agentDir: string, id: string): Promise<string | undefined> {
	const root = join(agentDir, BUS_DIR_NAME);
	let keys: string[];
	try {
		keys = await readdir(root);
	} catch {
		return undefined;
	}
	for (const key of keys) {
		const dir = join(root, key, SESSIONS_DIR_NAME);
		let names: string[];
		try {
			names = await readdir(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(await readFile(join(dir, name), "utf-8"));
			} catch {
				continue;
			}
			if (isSessionPayload(parsed) && parsed.id === id) return parsed.label;
		}
	}
	return undefined;
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
		const rawToken = (parsed as { startToken?: unknown }).startToken;
		const rawTurn = (parsed as { turnAt?: unknown }).turnAt;
		const told = new Set(seenOf((parsed as { seenMail?: unknown }).seenMail) ?? []);
		sessions.push({
			id,
			label,
			mode,
			lastSeen,
			mail: await mailCount(dir, storedName(id), told),
			...(pid === undefined ? {} : { pid }),
			...(typeof rawToken === "string" && rawToken !== "" ? { startToken: rawToken } : {}),
			...(typeof rawTurn === "number" && Number.isFinite(rawTurn) ? { turnAt: rawTurn } : {}),
			...(watching === undefined ? {} : { watching }),
		});
	}
	return sessions.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
