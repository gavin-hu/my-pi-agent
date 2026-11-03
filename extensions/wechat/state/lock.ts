/**
 * A pid lockfile that stops two Pi sessions from long-polling the same account
 * at once (they would clobber the cursor and double-reply).
 *
 * The liveness check and clock are injected so the logic is testable without a
 * real process or wall clock. A stale lock (dead pid, or older than `staleMs`)
 * is taken over.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hasErrorCode } from "../../../lib/errors.ts";
import { wechatDir } from "./credentials.ts";

/** Locks older than this are considered abandoned even if the pid is alive. */
export const DEFAULT_STALE_MS = 120_000;

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

/** Whether two reads are the same record, so a clean-up can leave a replaced one alone. */
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
		// Only the record this attempt judged is removed. A rival that replaced it
		// meanwhile owns a different one, and deleting that would leave the account
		// to nobody — so the next attempt re-reads it instead.
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
 */
export function refreshLock(path: string, deps: LockDeps): void {
	if (readLock(path)?.pid !== deps.pid) {
		acquireLock(path, deps);
		return;
	}
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, stamp(deps), "utf-8");
	renameSync(temp, path);
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
