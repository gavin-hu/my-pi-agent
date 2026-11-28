/**
 * The record this process serves on the bus.
 *
 * A record used to belong to a transcript: it was keyed by the id Pi minted for the session, and
 * the shutdown that ended one removed it. So a `/new` — the cheapest way to give the next card a
 * clean context — dropped the name a peer addresses, the cursor that counts its mail, the watch the
 * user set, the claims on the paths it was editing, and the card itself, which the board then handed
 * to the pool as an ended session's.
 *
 * None of that belonged to the transcript. A record belongs to the *process*: one Pi session runs in
 * one process, and a reset replaces the transcript inside it. So a start whose reason is `"new"`
 * serves the row the process left instead of minting one, and everything keyed by that id — inbox,
 * cursor, watch, claims, the card's owner — carries over with no write beyond the heartbeat.
 *
 * A `/reload` is the other half of the same rule: it replaces the extension runtime inside the same
 * process and session, so the shutdown keeps the row and the start that follows adopts it. Any start
 * whose session id already has a row adopts that row's name, start time and watch pair, whatever its
 * reason — a `/resume` hands a start an id whose row another process wrote, and Pi's transcript name
 * is not the name a peer addresses.
 *
 * Every guard fails toward minting, because the two failures are not the same size: a missed serve
 * costs a label and a card, both recoverable, while a wrong serve would hand one peer's mail and
 * work to another, which nothing recovers. A row is served only when the reason is `"new"`, no
 * record carries this session id, the row's pid and start token are this process's, it was written
 * on this machine, and it beat within {@link ADOPT_WINDOW_MS} of the start. A row that carries this
 * session id needs no such test: it is this session's own, read by id.
 *
 * A served row is not a memory. `startedAt` stays the row's — the peer began then, and the Team tab
 * must not draw it as new — while `cwd`, `repoRoot` and `mode` are the current context's facts and
 * are written as such. An adopted row reads the same: its name and its age are the row's, and the
 * pid, host, start token and context are this process's.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { sessionMode } from "./protocol.ts";
import { automaticLabel } from "./label.ts";
import type { BusStore } from "./store.ts";
import type { SessionRecord } from "./types.ts";

/**
 * How long after a shutdown a start may still serve the row it left.
 *
 * A `/new`'s stop and start are milliseconds apart, and the heartbeat is ten seconds, so a minute is
 * two orders of magnitude of slack for a real reset — and short enough that a reused pid cannot
 * serve a stranger's row. Past it the row is the TTL prune's, and the session mints.
 */
export const ADOPT_WINDOW_MS = 60_000;

/** What one start knows about itself, and the store it serves. */
export interface StartFacts {
	/** The host, for the name a session falls back to; a suite may hand a double. */
	pi: ExtensionAPI;
	store: BusStore;
	context: ExtensionContext;
	/** The pi session id this transcript has. */
	id: string;
	pid: number;
	/** The process's start time, when the platform can answer it: the one fact a reused pid cannot fake. */
	startToken?: string;
	/** This machine's id, absent in a store a suite built. */
	host?: string;
	/** Why the host says this start happened. */
	reason: SessionStartEvent["reason"] | undefined;
	cwd: string;
	/** The repository root, when the caller resolved one. */
	repoRoot: string;
	/** Whether git resolved the repository, so its working trees can be asked for. */
	fromGit: boolean;
	now: number;
}

/**
 * What one start serves: the record, and whether it is the row a `/new` left behind.
 *
 * The pair is the fact, not an inference from the ids: `served` is true only for the row the previous
 * transcript minted, which is the one the start joins and names its transcript with. An adopted row
 * hands its own name and age on but is not served — a `/reload` must not put a session on the bus on
 * the strength of a restart.
 */
export interface StartOutcome {
	record: SessionRecord;
	served: boolean;
}

/**
 * The record this process serves: the row its session id already has, else the row a `/new` left, else
 * a fresh one.
 *
 * A served row keeps the id the previous transcript minted, which is the whole point — the inbox,
 * the cursor, the watch and the claims are that id's. An adopted row keeps this session's id and the
 * row's name and age, because it is the same session. A minted one carries this session's id. The
 * answer says which it was, and the one that has to know is the start: a served row is already on the
 * bus with claims a card is worked under, so the process joins it.
 */
export async function startRecord(facts: StartFacts): Promise<StartOutcome> {
	const mode = sessionMode(facts.context.mode);
	// The row this session already has, whatever the reason it started: a `/reload` keeps the id, and a
	// resume can hand a start an id whose row another process wrote. Read once — it is both what the
	// start adopts and the row no row left behind may replace.
	const own = await facts.store.session(facts.id);
	const served = await servedRow(facts, own);
	if (served !== undefined) {
		// The row's id, name, mail, watch, claims and start time are its own; only what describes
		// this context now is written over them.
		return {
			record: { ...served, lastSeen: facts.now, cwd: facts.cwd, repoRoot: facts.repoRoot, mode },
			served: true,
		};
	}
	return {
		record: {
			id: facts.id,
			// The name a peer addresses and the moment the peer began are the row's when there is one; Pi's
			// transcript name and this clock are only for a session the bus has never seen.
			label:
				own?.label ??
				(await automaticLabel(facts.pi, {
					context: facts.context,
					cwd: facts.cwd,
					id: facts.id,
					fromGit: facts.fromGit,
				})),
			pid: facts.pid,
			...(facts.host === undefined ? {} : { host: facts.host }),
			cwd: facts.cwd,
			repoRoot: facts.repoRoot,
			mode,
			startedAt: own?.startedAt ?? facts.now,
			lastSeen: facts.now,
			// Asked once, here: a reused pid is settled from the record, not by this session polling
			// `ps` for its own heartbeat.
			...(facts.startToken === undefined ? {} : { startToken: facts.startToken }),
			// The watch pair the row already holds, carried so the first save after a start cannot erase it
			// before a join writes the mode again. The start itself writes nothing.
			...(own?.watch === undefined ? {} : { watch: own.watch }),
			...(own?.watching === undefined ? {} : { watching: own.watching }),
		},
		served: false,
	};
}

/**
 * What a pane that does not own its session's row is told when it asks to leave with it.
 *
 * It lives beside {@link ownsRow}, the rule it answers: a `/resume` in a second pane registers one
 * session id twice, and the pane that is leaving must not strip the row — or the claims — of the one
 * still working under it. The sentence names whose the row is, because the door that works is the
 * other pane's.
 */
export const OTHER_PANE = "another pane holds this session's record, so this one has nothing to give up";

/**
 * Whether this process may end `owner`'s row: it wrote it, or there is none to end.
 *
 * The one rule behind it: a `/resume` in a second pane registers the same session id twice, so a pane
 * that is leaving or stopping must not strip the row — and the claims — of the pane still working
 * under it. `endRecord` and the runtime's `leave` both ask this, so the two doors cannot disagree
 * about who owns a row. A row from another machine carries a coincident number often enough that
 * `own-record.ts`'s start guards `host` too; ending one is the same mistake with the same answer, and
 * the machine check is the start's because that is where a row is adopted.
 */
export function ownsRow(owner: SessionRecord | undefined, pid: number): boolean {
	return owner === undefined || owner.pid === pid;
}

/**
 * Release the record this process served, or keep it, as the shutdown says.
 *
 * A `/new` replaces the transcript and a `/reload` replaces the extension runtime, not the session: a
 * peer addresses the record and a card is owned by it, so it stays, and its claims with it — the next
 * start in this process adopts the same row. A `/new` refreshes the heartbeat because the beat has not
 * stopped; a `/reload` writes nothing, so a reload that never reaches its start ages on the heartbeat
 * the process last gave rather than on one the shutdown invented. Every other reason ends the session,
 * and removes what it held.
 *
 * The removal names the process that owns the row: a `/resume` in a second pane registers the same
 * session id twice, and the one that is stopping must not strip the survivor of the claims it is
 * still working under.
 */
export async function endRecord(facts: EndFacts): Promise<void> {
	const owner = await facts.store.session(facts.record.id).catch(() => undefined);
	if (facts.reason === "new") {
		if (owner !== undefined) await facts.store.writeSession({ ...owner, lastSeen: facts.now }).catch(() => {});
		return;
	}
	if (facts.reason === "reload") return;
	if (!ownsRow(owner, facts.pid)) return;
	await facts.store.releaseAll(facts.record.id).catch(() => {});
	await facts.store.removeSession(facts.record.id).catch(() => {});
}

/** What one shutdown knows about itself. */
export interface EndFacts {
	store: BusStore;
	record: SessionRecord;
	/** The process this runtime registered as. */
	pid: number;
	/** Why the host says this shutdown happened. */
	reason: SessionShutdownEvent["reason"] | undefined;
	now: number;
}

/**
 * The row this start may serve, or nothing.
 *
 * The order of the questions is the order of their cost, and the first one is the reason: only a
 * `/new` replaces the transcript inside a process. A `/resume` hands the process to a different
 * session, and a start that cannot name its reason is not one to serve.
 */
async function servedRow(facts: StartFacts, own: SessionRecord | undefined): Promise<SessionRecord | undefined> {
	if (facts.reason !== "new") return undefined;
	// A record already under this session id is this session's own, and the row this start adopts: the
	// one it left behind cannot replace it.
	if (own !== undefined) return undefined;
	// Without the start token, a reused pid is indistinguishable from the process that left the
	// row: mint rather than guess, and the reset costs a card instead of handing one over.
	if (facts.startToken === undefined) return undefined;
	const match = (await facts.store.sessions()).find(
		(row) =>
			row.pid === facts.pid &&
			row.startToken === facts.startToken &&
			row.host === facts.host &&
			facts.now - row.lastSeen <= ADOPT_WINDOW_MS,
	);
	return match;
}
