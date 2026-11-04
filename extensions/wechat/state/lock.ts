/**
 * A pid lockfile that stops two Pi sessions from long-polling the same account
 * at once (they would clobber the cursor and double-reply).
 *
 * The liveness check, clock, and timer are injected so the logic is testable without
 * a real process, wall clock, or interval. A stale lock — one whose holder stopped
 * beating, or whose pid is gone — is taken over.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasErrorCode } from "../../../lib/errors.ts";
import { defaultInterval, type RepeatTimer } from "../../../lib/timer.ts";
import { wechatDir } from "./credentials.ts";

/**
 * How often a polling holder re-stamps its record.
 *
 * The stamp at the top of a poll attempt is not a heartbeat: one attempt is
 * legitimately longer than the bar — a long-poll hold, then a batch whose media is
 * still downloading — so a holder that is alive and polling would age out between
 * two attempts and a rival would take an account nobody abandoned. See
 * {@link startLockHeartbeat}.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Locks older than this are considered abandoned even if the pid is alive.
 *
 * Four heartbeats: a healthy holder has to miss three in a row to look stale, which
 * leaves the bar wide enough that a beat late on a busy event loop is not an eviction.
 */
export const DEFAULT_STALE_MS = HEARTBEAT_MS * 4;

/**
 * How many exclusive creates one acquire may attempt.
 *
 * A miss means somebody else's file was there; clearing a stale one and retrying
 * costs an attempt, and a rival that keeps recreating it ends the loop with `false`.
 */
const ACQUIRE_ATTEMPTS = 3;

export interface LockInfo {
	pid: number;
	at: number;
}

export interface LockDeps {
	/** Current time in epoch milliseconds. */
	now: () => number;
	/** Whether a pid is alive. */
	isAlive: (pid: number) => boolean;
	/** This process id. */
	pid: number;
	/** Age after which a lock is ignored. */
	staleMs?: number;
}

/** The default lock path. */
export function lockPath(): string {
	return join(wechatDir(), "poller.lock");
}

function parseLock(text: string): LockInfo | undefined {
	try {
		const raw = JSON.parse(text);
		if (!raw || typeof raw !== "object") return undefined;
		const pid = (raw as Record<string, unknown>).pid;
		const at = (raw as Record<string, unknown>).at;
		if (typeof pid !== "number" || typeof at !== "number") return undefined;
		return { pid, at };
	} catch {
		return undefined;
	}
}

/** The raw lock record, or undefined when the file is missing or corrupt. */
export function readLock(path: string): LockInfo | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return parseLock(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

/** Whether one record blocks this process, by its pid, its age, and its owner. */
function blocks(info: LockInfo | undefined, deps: LockDeps): boolean {
	if (!info) return false;
	if (info.pid === deps.pid) return false;
	const stale = deps.now() - info.at > (deps.staleMs ?? DEFAULT_STALE_MS);
	if (stale) return false;
	return deps.isAlive(info.pid);
}

/** Whether two reads are the same record, so a clean-up leaves a replaced one alone. */
function sameLock(a: LockInfo | undefined, b: LockInfo | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.pid === b.pid && a.at === b.at;
}

/** This process's lock record. */
function stamp(deps: LockDeps): string {
	return JSON.stringify({ pid: deps.pid, at: deps.now() } satisfies LockInfo);
}

/**
 * Take the lock, or return false when another live session holds it.
 *
 * The exclusive create is the decision, not a read before it: two sessions that
 * both see a free lock cannot both write it, because the second `wx` fails. A
 * stale, corrupt, or own file in the way is cleared and the create retried, so a
 * takeover of an abandoned lock still works — and the next create still decides.
 */
export function acquireLock(path: string, deps: LockDeps): boolean {
	mkdirSync(dirname(path), { recursive: true });
	for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt += 1) {
		try {
			writeFileSync(path, stamp(deps), { encoding: "utf-8", flag: "wx" });
			return true;
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) throw error;
		}
		// Somebody's file is in the way. A live one refuses this acquire; a stale,
		// corrupt, or own one is cleared so that the next create can decide.
		const seen = readLock(path);
		if (blocks(seen, deps)) return false;
		// The delete is not conditional on that record: the check narrows the window to
		// one read, and the unlink after it removes whatever is at the path by then, so
		// a rival that replaced the file in between loses the record it just wrote.
		// Nothing is handed to nobody for long — the next create is still the decision,
		// and a rival whose record this removed finds the lock gone on its own next
		// refresh and stops polling rather than sharing the account.
		if (!sameLock(readLock(path), seen)) continue;
		// Clearing the way only pays on an attempt that can still create: the last one
		// must leave the stale record in place rather than hand the account to nobody.
		if (attempt === ACQUIRE_ATTEMPTS - 1) return false;
		rmSync(path, { force: true });
	}
	return false;
}

/**
 * Re-stamp the lock while the poller runs.
 *
 * Only a record that is still ours is restamped: after a stale takeover the file
 * holds the new holder's pid, and stamping ours over it would both claim the
 * account back and let our release delete their lock. Anything else is offered to
 * `acquireLock`, which takes a released or stale lock and leaves a live one alone.
 *
 * The new record lands by rename, so the file is never empty on the way: a plain
 * truncating write leaves a moment with no record at all, and a rival that reads it
 * then takes a live lock's file for a stale one and claims the account beside us.
 *
 * Answers whether this process holds the lock afterwards: a released or stale lock is
 * taken back and says `true`, and a live record another pid owns is the one answer of
 * `false` — the account is theirs now, and a caller that kept polling would read a
 * second cursor and answer their peers twice.
 */
export function refreshLock(path: string, deps: LockDeps): boolean {
	if (readLock(path)?.pid !== deps.pid) return acquireLock(path, deps);
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, stamp(deps), "utf-8");
	renameSync(temp, path);
	return true;
}

/**
 * Re-stamp the record on a timer, for as long as the returned stop function is not
 * called.
 *
 * `beat` is {@link refreshLock} in the caller's environment, so a beat that cannot
 * prove ownership still ends the poller through the same answer. The stop call must
 * land before the lock is released: a beat left running would re-stamp — or take back
 * — a record this process no longer holds.
 *
 * A beat that throws is dropped rather than left to the timer, where an uncaught error
 * takes the process down. The record then ages out on its own, which is the bar's job.
 */
export function startLockHeartbeat(beat: () => void, every: RepeatTimer = defaultInterval): () => void {
	return every(HEARTBEAT_MS, () => {
		try {
			beat();
		} catch {
			// A best-effort stamp: see the doc above.
		}
	});
}

/** Release the lock if this process owns it. */
export function releaseLock(path: string, pid: number): void {
	if (!existsSync(path)) return;
	const info = parseLock(readFileSync(path, "utf-8"));
	if (info && info.pid !== pid) return;
	try {
		rmSync(path, { force: true });
	} catch {
		// The lock is advisory; a lingering file is taken over when stale.
	}
}
