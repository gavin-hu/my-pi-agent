/**
 * One board's write lock: the file a mutation holds across the read of the board, the check it
 * makes against that read, and the write that follows.
 *
 * **The unit is the board, not the card.** A mutation reads the whole board because the rules
 * ask about *other* cards — would this link close a loop, does anything still wait on the card
 * being dropped, has this lane a slot left — so a per-card lock guarded half of one question:
 * two writers on two cards held two locks, read two snapshots, and both passed a rule neither
 * could have passed alone. `#1 dependsOn [2]` beside `#2 dependsOn [1]` closed a loop that
 * `wouldCycle` refuses for one caller, and two claims each read `plan: 2/3` and both entered.
 * One name per board is the smallest window those questions fit in, and a board is tens of
 * files, so what the wider window costs is the contention of one rename.
 *
 * The exclusive create is the decision, not a read before it: two sessions that both see a
 * free lock cannot both write it, because the second `wx` fails. A holder needs one board read
 * and one rename, so a file still there seconds later is a process that died inside that
 * window — it is taken over rather than waited on, and only the holder's own token lets it
 * release a file.
 *
 * Three things this lock is deliberately not. `create` takes none: it allocates an id nobody
 * has used and reads directory names, so it cannot break a board-wide rule, and an add landing
 * beside a claim is the one pair that is free. Reads take none: a snapshot is a read, and the
 * next one is true. And a mutation must not start another while it holds this lock — it would
 * wait out its own window and its own retries — which is why `store.mutate`'s suite seam is
 * called before the lock is taken, not inside it.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "../errors.ts";

/** How long one acquisition waits for a live holder before answering nothing. */
export const LOCK_WAIT_MS = 100;

/** An age past which a lock is abandoned: a board read and a rename never take this long. */
export const LOCK_STALE_MS = 2_000;

/** How long one acquisition sleeps between attempts. */
const POLL_MS = 2;

/** How many abandoned locks one acquisition clears before it stops trying. */
const TAKEOVERS = 2;

/** A lock is a private record of a process: the user's eyes only, like a card. */
const LOCK_MODE = 0o600;

/** The lock's one name, beside the board's `cards/` and `archive/` piles. */
export const BOARD_LOCK_NAME = ".lock-board";

/** What one holder wrote: who, and the token that makes it theirs. */
interface Held {
	pid: number;
	token: string;
}

/** A lock this acquisition holds, and the one call that gives it back. */
export interface BoardLock {
	/** Remove the lock file, if it still carries this acquisition's token. */
	release(): Promise<void>;
}

/** The lock file for one board: a dotfile at its root, so no pile lists it as a card. */
export function lockPathFor(dir: string): string {
	return join(dir, BOARD_LOCK_NAME);
}

/** What a caller may vary: a suite proves the age rule without waiting for it. */
export interface LockOptions {
	/** How long to wait for a live holder. */
	waitMs?: number;
	/** The age past which a lock is abandoned. */
	staleMs?: number;
	/** The clock, in epoch milliseconds. */
	now?: () => number;
}

/**
 * Take the board's write lock, or answer nothing when a live writer held it for the whole wait.
 *
 * The answer is the lock itself: a caller that got one holds the board, and a caller that got
 * nothing has not written and is free to read again.
 */
export async function lockBoard(dir: string, options: LockOptions = {}): Promise<BoardLock | undefined> {
	const path = lockPathFor(dir);
	const waitMs = options.waitMs ?? LOCK_WAIT_MS;
	const staleMs = options.staleMs ?? LOCK_STALE_MS;
	const now = options.now ?? Date.now;
	const held: Held = { pid: process.pid, token: randomUUID() };
	const text = JSON.stringify(held);
	// The board directory is the one the cards live in, so it is there; the create is still
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
 * A takeover leaves the old holder with a token that is no longer in the file, so its release
 * finds somebody else's record and leaves it: the writer that took over is the one that holds
 * the board now, and a late release must not open it to a third.
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
