/**
 * A pid lockfile that stops two Pi sessions from long-polling the same account
 * at once (they would clobber the cursor and double-reply).
 *
 * The liveness check and clock are injected so the logic is testable without a
 * real process or wall clock. A stale lock (dead pid, or older than `staleMs`)
 * is taken over.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { wechatDir } from "./credentials.ts";

/** Locks older than this are considered abandoned even if the pid is alive. */
export const DEFAULT_STALE_MS = 120_000;

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

/** True when the existing lock blocks a new owner. */
export function isLocked(path: string, deps: LockDeps): boolean {
	if (!existsSync(path)) return false;
	const info = parseLock(readFileSync(path, "utf-8"));
	if (!info) return false;
	if (info.pid === deps.pid) return false;
	const stale = deps.now() - info.at > (deps.staleMs ?? DEFAULT_STALE_MS);
	if (stale) return false;
	return deps.isAlive(info.pid);
}

/** Take the lock, or return false when another live session holds it. */
export function acquireLock(path: string, deps: LockDeps): boolean {
	if (isLocked(path, deps)) return false;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ pid: deps.pid, at: deps.now() } satisfies LockInfo), "utf-8");
	return true;
}

/** Re-stamp the lock while the poller runs. */
export function refreshLock(path: string, deps: LockDeps): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ pid: deps.pid, at: deps.now() } satisfies LockInfo), "utf-8");
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
