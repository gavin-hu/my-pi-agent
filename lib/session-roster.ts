/**
 * Who is on this repository's session bus, read as data.
 *
 * The Team tab lists teammates, and `session-bus` owns those records. Neither extension may import the
 * other, and the board must keep working when the bus is not loaded — so the records are read where
 * the bus already put them, `<agent-dir>/repos/<repo-id>/session-bus/`, as files rather than through
 * its code. The directory names, the record fields this reader trusts, and the liveness rule live here
 * once, and `session-bus` imports them, so a layout change cannot land in one copy and not the other.
 * The layout is loaded by the read that spells a path rather than at import: `board`, `team` and `job`
 * each pay this module's static imports, and none of them needs a path before a call.
 *
 * The rule answers three things, not two: a record whose process is gone is `gone` at once, rather than
 * aging into `quiet` while the paths it claimed stay held. It is this *machine's* rule, though: a bus
 * directory can be replicated, so a record names the host that wrote it, and `recordFacts` settles whether
 * this machine may judge its pid at all before the rule sees it — a stranger's pid is a local process by
 * coincidence, and its heartbeat is the only evidence there is. `readTeam` draws those machines from
 * `hosts/` beside the records, so one pass answers who is here and which machines they are on.
 *
 * A missing directory is an answer, not an error: no session ever joined, which reads differently from an
 * empty bus.
 *
 * Two questions are asked of these records, and both are answered here because they are one rule over one
 * file. `presenceOf` reports what an owner is — live, quiet, gone, or absent from a bus that has pruned it
 * — which is what a card's lane depends on. `peerOf` addresses a name: which record a message goes to, and
 * what it says about reading it; `lookupPeer` adds the fact a refusal needs, the several live records a
 * label is shared by — a question answered three times, three different ways, before it lived here.
 *
 * Pure I/O, no state: one read answers one caller, nothing is cached — a heartbeat is ten seconds old at
 * most — and the caller polls on its own clock.
 */

import { join } from "node:path";
import type { WaitingPage } from "./session-mail.ts";
import { sameLabel } from "./session-label.ts";
import type { HostRecord } from "./session-files.ts";
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
	/**
	 * The machine that wrote the record, when the record named one.
	 *
	 * A record with no host was written by a build that had one notion of "here", so this machine
	 * wrote it; every record this build writes carries {@link host}, which is what lets a replicated
	 * store tell its own sessions from the other machine's.
	 */
	host?: string;
	/**
	 * Whether that machine is a different one, decided by the read that knows its own.
	 *
	 * `true` is a record this machine must not judge by pid: a stranger's pid names a local process
	 * that has nothing to do with the session, so the heartbeat is the only evidence there is.
	 * Absent is this machine's record — which is also every record an older build wrote.
	 */
	foreign?: true;
	/** Messages waiting in its inbox that the record does not say it was told about. */
	mail: number;
	/** Message files in its inbox this build cannot parse; absent when there are none. Not part of
	 * `mail`, since nobody can open one, but carried because silence about it is what made the page
	 * disagree with `session status`. */
	refused?: readonly string[];
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
export type RosterFacts = Pick<RosterSession, "lastSeen" | "pid" | "startToken" | "foreign">;

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
 *
 * Both process branches are skipped on a record another machine wrote ({@link RosterFacts.foreign}):
 * its pid is a local process by coincidence, and its start time is another machine's clock. The
 * heartbeat is then the whole rule, which is why a foreign session reads `quiet` and never `gone`
 * — "cannot tell" is not a death.
 */
export function rosterStateOf(
	session: RosterFacts,
	now: number,
	ttlMs = SESSION_TTL_MS,
	seams: RosterSeams = {},
): RosterState {
	const alive = seams.alive ?? isPidAlive;
	// The one gate both pid branches pass: a stranger's process is not this record's evidence.
	const own = session.foreign !== true;
	if (own && session.pid !== undefined && !alive(session.pid)) return "gone";
	if (now - session.lastSeen <= ttlMs) return "live";
	if (own && session.pid !== undefined && session.startToken !== undefined) {
		const current = (seams.token ?? startTokenOf)(session.pid);
		if (current !== undefined && current !== session.startToken) return "gone";
	}
	return "quiet";
}

/**
 * One record's facts, with the one decision its reader is the only one able to make.
 *
 * A record names the machine that wrote it; whether that machine is *this* one is a fact only a
 * caller with its own identity can settle. Deciding it at the read is what keeps
 * {@link rosterStateOf} from judging a stranger's pid: the seam it applies is `foreign`, so a
 * caller that never asked cannot accidentally skip it.
 *
 * `host` is this machine's id, or `undefined` when the caller cannot name itself — and then a
 * record that names a host is not one it can vouch for, which is why "cannot tell" falls to the
 * heartbeat rather than to a local `ps`.
 */
export function recordFacts<T extends RosterFacts & { host?: string }>(
	facts: T,
	host: string | undefined,
): T & Pick<RosterFacts, "foreign"> {
	return facts.host === undefined || facts.host === host ? facts : { ...facts, foreign: true as const };
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

/**
 * What {@link peerRowOf} reads — the narrowing {@link RosterFacts} gives {@link rosterStateOf}, since
 * the bus addresses with records that count mail differently.
 */
export type PeerSource = RosterFacts & Pick<RosterSession, "id" | "label" | "watching">;

/** One session record as addressing reads it: its liveness at `now`, and the watch it carries. */
export function peerRowOf(session: PeerSource, now: number): PeerRow {
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
 * The rows a name may reach: gone is not an addressee, and `self` — the asking session — is one
 * whatever its record says, because a session is its own recipient. Absent state and quiet remain.
 */
export function addressable(rows: readonly PeerRow[], self?: string): PeerRow[] {
	return rows.filter((row) => row.state !== "gone" || row.id === self);
}

/** What a name reached, with the one fact {@link peerOf} drops: the ids of the live records the
 * label is shared by, which a caller words itself rather than guessing between them. */
export interface PeerLookup {
	/** The record the name reaches, by {@link peerOf}'s three steps. */
	peer?: PeerRow;
	/** The ids of the live records sharing the label, when more than one holds it. */
	ambiguous?: readonly string[];
}

/**
 * The record a name reaches, by the one rule both extensions address mail with.
 *
 * Three steps, because an id is an identity and a label is a role:
 *
 * 1. the record with this id, when it is live — a live session named by its id is that session;
 * 2. the one live record whose label matches — exactly one, because a caller that guessed would
 *    address one session's mail under another's name;
 * 3. the record with this id whatever its state, so a session that has stopped can be reported as
 *    stopped rather than as nobody. A caller that writes mail must read `state`: the bus writes no
 *    file for a record it calls gone.
 *
 * Nothing answers for a label no record holds, nor for a roster that cannot be read — which is not
 * "nobody is here"; each caller words its own fallback.
 *
 * `self` is the asking session, kept addressable whatever its record says.
 */
export function lookupPeer(rows: readonly PeerRow[] | undefined, name: PeerName, self?: string): PeerLookup {
	if (rows === undefined) return {};
	const live = addressable(rows, self);
	const byId = name.id === undefined ? undefined : live.find((row) => row.id === name.id);
	if (byId !== undefined) return { peer: byId };
	const matches = live.filter((row) => sameLabel(row.label, name.label));
	if (matches.length === 1) return { peer: matches[0] };
	const ambiguous = matches.length > 1 ? matches.map((row) => row.id) : undefined;
	const stopped = name.id === undefined ? undefined : rows.find((row) => row.id === name.id);
	return {
		...(ambiguous === undefined ? {} : { ambiguous }),
		...(stopped === undefined ? {} : { peer: stopped }),
	};
}

/** The record a name reaches, or nothing: {@link lookupPeer} with the ambiguity dropped, because a
 * caller that only addresses does not word one. The stopped record and the nothing are what a card
 * and a handoff fall back on. */
export function peerOf(rows: readonly PeerRow[] | undefined, name: PeerName): PeerRow | undefined {
	return lookupPeer(rows, name).peer;
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

/** What a listing marks on a peer's row: the facts a call acts on, and nothing else. */
export type PeerMark = "gone" | "not listening";

/**
 * The mark a listing prints on a peer's row, when its record says something the next call will act on.
 *
 * The other half of {@link peerAlarm}, from the same fields by the same rule: a listing cannot say
 * what a send result says, because it names the peer *before* anyone writes to it. `gone` comes
 * first and alone — a stopped session is refused rather than delivered to, so its watch is not a
 * second fact — and `quiet` is deliberately unmarked: it changes no outcome, every idle peer is
 * quiet, and a mark on every row would say nothing. The words are the ones the alarm and the refusal
 * print, so no surface spells a peer's state its own way.
 */
export function peerMark(peer: Pick<PeerRow, "state" | "listening">): PeerMark | undefined {
	if (peer.state === "gone") return "gone";
	return peerAlarm(peer) === "not-listening" ? "not listening" : undefined;
}

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

/** A record's pid, read only when it is the shape a pid has. */
function pidOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** One record as this reader parsed it, before the ledger turns it into a row. */
interface RecordedSession {
	id: string;
	label: string;
	mode: string;
	lastSeen: number;
	/** The message ids its cursor names, which is what its inbox count subtracts. */
	told: string[];
	pid?: number;
	startToken?: string;
	turnAt?: number;
	watching?: { armed: boolean; wake: boolean };
	/** The machine the record named, when it named one. */
	host?: string;
}

/** The bus as the page draws it: who is on it, what is waiting on it, and the machines behind both. */
export interface TeamRead {
	/** `undefined` when the bus has never been used in this repository. */
	roster: RosterSession[] | undefined;
	/** The queue that same read drew, so a page pays no second pass for it. */
	waiting: WaitingPage;
	/**
	 * The machine entries under `hosts/`: every machine that has written here, this one included.
	 *
	 * Carried beside the rows because a machine is a different fact from a session — it outlives
	 * every record it wrote, which is what lets a page say "last seen 3h ago" about a peer whose
	 * sessions have all been pruned.
	 */
	hosts?: HostRecord[];
}

/** What one read of the bus needs beyond the directory. */
export interface TeamReadOptions {
	/** How many waiting messages to draw. */
	limit?: number;
	/**
	 * This machine's host id, so a record's machine can be judged at the read.
	 *
	 * Absent is a caller that cannot name its own machine: every record that names a host is then
	 * foreign to it, because a record it cannot vouch for must not be judged by a local pid.
	 */
	host?: string;
}

/**
 * Every session the bus has recorded for one repository, or `undefined` when the bus
 * has never been used here.
 *
 * One file that does not parse is skipped rather than thrown: a roster with three
 * good sessions is worth more than an error about the fourth.
 *
 * The mail number comes from the ledger in `session-mail.ts`, the one reader of "written and not
 * told", so a row, a chip and a queue cannot count one inbox differently.
 */
export async function readRoster(dir: string, options: TeamReadOptions = {}): Promise<RosterSession[] | undefined> {
	return (await readTeam(dir, options)).roster;
}

/**
 * The roster and the waiting queue from one pass over the bus.
 *
 * A page draws both every second, and both come from the same inboxes: reading the records here
 * and then walking every inbox twice is what this shape exists to stop. The mail module is loaded
 * by the call rather than by the import, because every entry that shows a teammate also imports
 * this file, and the ledger is only needed once one is drawn.
 */
export async function readTeam(dir: string, options: TeamReadOptions = {}): Promise<TeamRead> {
	const records = await readRecords(dir);
	if (records === undefined) return { roster: undefined, waiting: { messages: [], dropped: 0 } };
	const mail = await import("./session-mail.ts");
	const { readHosts } = await import("./session-files.ts");
	const [ledger, hosts] = await Promise.all([
		mail.readMailLedger(
			dir,
			records.map((record) => ({ id: record.id, label: record.label, told: record.told })),
		),
		// The machines come from the same pass as the rows a page draws: one directory read, and a
		// host that arrived since the last frame is part of the frame that draws it.
		readHosts(dir),
	]);
	return {
		roster: records
			.map((record) =>
				rosterRow(
					record,
					mail.untoldIn(ledger, record.id),
					mail.refusedIn(ledger, record.id),
					recordFacts(record, options.host).foreign === true,
				),
			)
			.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
		waiting: mail.pageOf(ledger, options.limit),
		...(hosts.length === 0 ? {} : { hosts }),
	};
}

/**
 * Every record on disk, parsed once, or `undefined` when the bus has never recorded one.
 *
 * `undefined` and `[]` are different answers — a machine where the bus was never used, and a bus
 * whose sessions have all gone — so the walk reports a directory that is not there, and the
 * distinction survives the shared parser.
 *
 * This reader requires what the bus requires: since #992 one writer holds the record, so a file
 * missing `pid`, `cwd`, `repoRoot` or `startedAt` is not one this build wrote. A row it cannot
 * read is not drawn, which is the same answer the bus gives — the two readers agreeing about
 * which files are sessions is the point of them sharing this walk.
 */
async function readRecords(dir: string): Promise<RecordedSession[] | undefined> {
	const { SESSIONS_DIR_NAME, parseSessionRecord, readDocuments, seenOf, watchingOf } = await import(
		"./session-files.ts"
	);
	const { records, missing } = await readDocuments(join(dir, SESSIONS_DIR_NAME), parseSessionRecord);
	if (missing) return undefined;
	return records.map((record) => {
		const watching = watchingOf(record.watching);
		const pid = pidOf(record.pid);
		return {
			id: record.id,
			label: record.label,
			mode: record.mode,
			lastSeen: record.lastSeen,
			told: seenOf(record.seenMail) ?? [],
			...(pid === undefined ? {} : { pid }),
			...(record.startToken === undefined || record.startToken === "" ? {} : { startToken: record.startToken }),
			...(typeof record.turnAt === "number" && Number.isFinite(record.turnAt) ? { turnAt: record.turnAt } : {}),
			...(watching === undefined ? {} : { watching }),
			...(record.host === undefined || record.host === "" ? {} : { host: record.host }),
		};
	});
}

/** One record as the page's row: what it says, how much mail it is owed, and what it cannot read. */
function rosterRow(record: RecordedSession, mail: number, refused: readonly string[], foreign: boolean): RosterSession {
	return {
		id: record.id,
		label: record.label,
		mode: record.mode,
		lastSeen: record.lastSeen,
		mail,
		...(record.host === undefined ? {} : { host: record.host }),
		...(foreign ? { foreign: true as const } : {}),
		...(refused.length === 0 ? {} : { refused }),
		...(record.pid === undefined ? {} : { pid: record.pid }),
		...(record.startToken === undefined ? {} : { startToken: record.startToken }),
		...(record.turnAt === undefined ? {} : { turnAt: record.turnAt }),
		...(record.watching === undefined ? {} : { watching: record.watching }),
	};
}
