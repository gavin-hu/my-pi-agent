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
 * Every guard fails toward minting, because the two failures are not the same size: a missed serve
 * costs a label and a card, both recoverable, while a wrong serve would hand one peer's mail and
 * work to another, which nothing recovers. A row is served only when the reason is `"new"`, no
 * record carries this session id, the row's pid and start token are this process's, it was written
 * on this machine, and it beat within {@link ADOPT_WINDOW_MS} of the start.
 *
 * A served row is not a memory. `startedAt` stays the row's — the peer began then, and the Team tab
 * must not draw it as new — while `cwd`, `repoRoot` and `mode` are the current context's facts and
 * are written as such.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { SessionMode } from "./protocol.ts";
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
	mode: SessionMode;
	/** The repository root, when the caller resolved one. */
	repoRoot: string;
	/** Whether git resolved the repository, so its working trees can be asked for. */
	fromGit: boolean;
	now: number;
}

/** The record this process serves: the row a `/new` left behind, else a fresh one. */
export async function startRecord(facts: StartFacts): Promise<SessionRecord> {
	const served = await servedRow(facts);
	if (served !== undefined) {
		// The row's id, name, mail, watch, claims and start time are its own; only what describes
		// this context now is written over them.
		return { ...served, lastSeen: facts.now, cwd: facts.cwd, repoRoot: facts.repoRoot, mode: facts.mode };
	}
	return {
		id: facts.id,
		label: await automaticLabel(facts.pi, {
			context: facts.context,
			cwd: facts.cwd,
			id: facts.id,
			fromGit: facts.fromGit,
		}),
		pid: facts.pid,
		...(facts.host === undefined ? {} : { host: facts.host }),
		cwd: facts.cwd,
		repoRoot: facts.repoRoot,
		mode: facts.mode,
		startedAt: facts.now,
		lastSeen: facts.now,
		// Asked once, here: a reused pid is settled from the record, not by this session polling
		// `ps` for its own heartbeat.
		...(facts.startToken === undefined ? {} : { startToken: facts.startToken }),
	};
}

/**
 * Release the record this process served, or keep it, as the shutdown says.
 *
 * A `/new` replaces the transcript, not the session: a peer addresses the record and a card is
 * owned by it, so it stays, and its claims with it — the next start in this process serves the same
 * row. Every other reason ends the session, and removes what it held.
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
	if (owner !== undefined && owner.pid !== facts.pid) return;
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
async function servedRow(facts: StartFacts): Promise<SessionRecord | undefined> {
	if (facts.reason !== "new") return undefined;
	// A record already under this session id is this session's own, read by id rather than guessed
	// at: a `/reload` keeps it, and the start that follows one serves it as it always has.
	if ((await facts.store.session(facts.id)) !== undefined) return undefined;
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
