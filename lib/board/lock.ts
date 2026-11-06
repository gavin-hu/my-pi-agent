/**
 * One card's write lock: the file a mutation holds across the read, the check it
 * makes against it, and the write that follows, so two sessions on one card take
 * turns instead of one overwriting the other while both report success.
 *
 * The exclusive create is the decision, not a read before it: two sessions that
 * both see a free lock cannot both write it, because the second `wx` fails. The
 * lock names the card rather than the writer and keeps one name per card, so a
 * writer that finds the card in the archive contends with one that found it on the
 * board — the same card, whatever pile its file lies in.
 *
 * A holder only needs one read and one rename, so a lock still there seconds later
 * is a process that died inside that window: it is taken over rather than waited
 * on. The takeover is not free — a holder that was merely slow loses the write it
 * was about to make — so the bar is seconds, not milliseconds, and only the
 * holder's own token lets it release a file.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "../errors.ts";

/** How long one acquisition waits for a live lock before answering nothing. */
export const LOCK_WAIT_MS = 100;

/** An age past which a lock is abandoned: a read and a rename never take this long. */
export const LOCK_STALE_MS = 2_000;

/** How long one acquisition sleeps between attempts. */
const POLL_MS = 2;

/** How many abandoned locks one acquisition clears before it stops trying. */
const TAKEOVERS = 2;

/** A lock is a private record of a process: the user's eyes only, like a card. */
const LOCK_MODE = 0o600;

/** What one holder of the lock wrote: who, and the token that makes it theirs. */
interface Held {
	pid: number;
	token: string;
}

/** A lock this acquisition holds, and the one call that gives it back. */
export interface CardLock {
	/** Remove the lock file, if it still carries this acquisition's token. */
	release(): Promise<void>;
}

/** The lock file for one card: a dotfile, so no reader lists it as a card. */
export function lockPathFor(dir: string, id: string): string {
	return join(dir, `.lock-${id}`);
}

/** What a caller may vary: a suite proves the age rule without waiting for it. */
export interface LockOptions {
	/** How long to wait for a live lock. */
	waitMs?: number;
	/** The age past which a lock is abandoned. */
	staleMs?: number;
	/** The clock, in epoch milliseconds. */
	now?: () => number;
}

/**
 * Take one card's write lock, or answer nothing when a live writer held it for
 * the whole wait.
 *
 * The answer is the lock itself: a caller that got one holds the card, and a
 * caller that got nothing has not written and is free to read again.
 */
export async function lockCard(dir: string, id: string, options: LockOptions = {}): Promise<CardLock | undefined> {
	const path = lockPathFor(dir, id);
	const waitMs = options.waitMs ?? LOCK_WAIT_MS;
	const staleMs = options.staleMs ?? LOCK_STALE_MS;
	const now = options.now ?? Date.now;
	const held: Held = { pid: process.pid, token: randomUUID() };
	const text = JSON.stringify(held);
	// The directory is the one the card's file lives in, so it is there; the create is still
	// asked to make it, because a missing directory would fail as an error, not as a taken name.
	await mkdir(dir, { recursive: true });
	const deadline = now() + waitMs;
	let takeovers = 0;
	for (;;) {
		try {
			await writeFile(path, text, { encoding: "utf-8", flag: "wx", mode: LOCK_MODE });
			return { release: () => clearLock(path, held.token) };
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) throw error;
		}
		// Somebody's file is in the way. A fresh one is theirs to keep; an abandoned one is
		// cleared so that the next create — the decision — can be made again.
		if (takeovers < TAKEOVERS && (await abandoned(path, now, staleMs))) {
			takeovers += 1;
			// The read above narrows the window to one stat: this removal takes whatever is at
			// the path by now, so a rival that replaced the file in between loses the record it
			// just wrote — and the next create decides again, so it is not handed to nobody.
			await rm(path, { force: true });
			continue;
		}
		if (now() >= deadline) return undefined;
		await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
	}
}

/** Whether the file at `path` is older than the bar a held lock may pass. */
async function abandoned(path: string, now: () => number, staleMs: number): Promise<boolean> {
	const info = await stat(path).catch(() => undefined);
	return info !== undefined && now() - info.mtimeMs > staleMs;
}

/**
 * Give the lock back, if it is still this acquisition's.
 *
 * A takeover leaves the old holder with a token that is no longer in the file, so its
 * release finds somebody else's record and leaves it: the writer that took over is the
 * one that holds the card now, and a late release must not open it to a third.
 */
async function clearLock(path: string, token: string): Promise<void> {
	const raw = await readFile(path, "utf-8").catch(() => undefined);
	if (raw === undefined || tokenOf(raw) !== token) return;
	await rm(path, { force: true });
}

/** The token a lock file carries, or nothing when it is unreadable or not a lock. */
function tokenOf(raw: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const token = (parsed as { token?: unknown }).token;
	return typeof token === "string" ? token : undefined;
}
