/**
 * The gate's machine-wide lock: one `bun run check` at a time on one machine.
 *
 * A gate runs four test files at once, and several suites spawn git, a shell, or a browser. One
 * gate on an idle box fits; two or three started from two or three worktrees do not, and the
 * suites that wait on a child are the ones that break — on 2026-11-09 a shell spawn starved past
 * its 27.5 s half of the watchdog and a `git` call past the whole 55 s, each while another
 * checkout was being checked, each green alone and on the re-run. The contended resource is the
 * CPU, not the repository, so the lock is one file on the machine rather than one per checkout.
 *
 * The claim is atomic — a temp file linked into place, as the board's page pointer does — so a
 * waiting gate never reads a half-written file and mistakes it for a stale one. A holder that
 * dies without releasing is recovered by pid rather than by age: the OS answers whether the
 * process still exists, which needs no clock and behaves the same on every platform.
 */

import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The lock file's name: one gate per machine, whichever checkouts started it. */
const LOCK_NAME = "my-pi-agent-check.lock";

/** How long a second gate waits for a live holder before it runs beside it and says so. */
export const GATE_WAIT_MS = 10 * 60_000;

/** How often a waiting gate looks again while a holder is alive. */
export const GATE_POLL_MS = 500;

/** What a gate records about itself: who has the machine, from where, and since when. */
export interface GateHolder {
	pid: number;
	path: string;
	since: number;
}

/** One process's claim on the machine, and how it went. */
export interface GateLock {
	/** Whether this gate owns the lock; `false` after a wait it did not win. */
	readonly held: boolean;
	/** Milliseconds spent waiting for a holder. */
	readonly waitedMs: number;
	/** The holder this gate waited on, when there was one. */
	readonly holder: GateHolder | undefined;
	/** The stale holder this gate replaced, when it replaced one. */
	readonly tookOver: GateHolder | undefined;
	/** Remove the lock when it is still ours. Safe to call more than once. */
	release: () => void;
}

/** How a gate takes the lock; every seam is injectable so a case needs no second process. */
export interface GateLockOptions {
	/** Directory to keep the lock in; a case uses its own. */
	dir?: string;
	/** Run without touching the lock, which is what `--no-lock`, `--watch`, and `--dry-run` do. */
	skip?: boolean;
	/** How long to wait for a live holder before running anyway. */
	waitMs?: number;
	/** How often to look again while waiting. */
	pollMs?: number;
	/** This process, as the lock records it. */
	pid?: number;
	/** Where this gate was started, for the waiting line. */
	path?: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	/** Whether a pid is still running. */
	alive?: (pid: number) => boolean;
	/** Called once, the first time a live holder is found. */
	onWait?: (holder: GateHolder) => void;
	/** Called when a dead or unreadable holder's file was replaced by ours. */
	onTakeOver?: (holder: GateHolder | undefined) => void;
	/** Called when the wait ran out and this gate runs beside the holder. */
	onGiveUp?: (holder: GateHolder, waitedMs: number) => void;
}

/** The lock file's path: the machine's temp directory unless a caller says otherwise. */
export function lockPath(dir: string = tmpdir()): string {
	return join(dir, LOCK_NAME);
}

/**
 * Whether a process is still running.
 *
 * `EPERM` is the interesting answer: the OS refuses a signal to a process that exists but
 * belongs to another user, which is alive, where `ESRCH` is a process that is gone.
 */
export function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && (error as { code?: string }).code === "EPERM";
	}
}

/** Whether an error is the OS refusing to create a name that is taken. */
function isTaken(error: unknown): boolean {
	return error instanceof Error && (error as { code?: string }).code === "EEXIST";
}

/** What the lock file says right now: nothing, something no gate wrote, or a holder. */
export type GateLockReading = { kind: "absent" } | { kind: "unreadable" } | { kind: "holder"; holder: GateHolder };

/**
 * Read the lock file.
 *
 * Absent and unreadable are different answers: a lock file that vanished means the holder
 * finished, which is this gate's chance to start silently, while a file no gate wrote is one
 * nobody can release and has to be replaced.
 */
export function readGateLock(file: string): GateLockReading {
	let text: string;
	try {
		text = readFileSync(file, "utf-8");
	} catch (error) {
		return error instanceof Error && (error as { code?: string }).code === "ENOENT"
			? { kind: "absent" }
			: { kind: "unreadable" };
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { kind: "unreadable" };
	}
	if (typeof value !== "object" || value === null) return { kind: "unreadable" };
	const record = value as Partial<Record<keyof GateHolder, unknown>>;
	const { pid, path, since } = record;
	if (typeof pid !== "number" || typeof path !== "string" || typeof since !== "number") {
		return { kind: "unreadable" };
	}
	return { kind: "holder", holder: { pid, path, since } };
}

/**
 * Put a fresh lock in place, atomically.
 *
 * The temp file is written whole and then linked to the lock's name: a reader sees either no
 * lock or a complete one, and `link` refuses a name that exists, which is the claim itself.
 */
function placeLock(file: string, holder: GateHolder): boolean {
	const temp = `${file}.${holder.pid}.${Math.random().toString(16).slice(2, 10)}`;
	writeFileSync(temp, `${JSON.stringify(holder)}\n`);
	try {
		linkSync(temp, file);
		return true;
	} catch (error) {
		if (!isTaken(error)) throw error;
		return false;
	} finally {
		rmSync(temp, { force: true });
	}
}

/**
 * Take the machine's gate lock, waiting for a live holder.
 *
 * A lock whose holder is gone, or a file no gate wrote, is replaced rather than waited on. A live
 * holder is waited for up to `waitMs`, announced once, and then run beside — a gate that never
 * starts is worse than one that runs into contention it was told about. A lock that disappears
 * while this gate waits is the holder finishing: this gate then starts silently, because nothing
 * was taken from anyone.
 */
export async function acquireGateLock(options: GateLockOptions = {}): Promise<GateLock> {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const alive = options.alive ?? processAlive;
	const file = lockPath(options.dir);
	const waitMs = options.waitMs ?? GATE_WAIT_MS;
	const pollMs = options.pollMs ?? GATE_POLL_MS;
	const mine: GateHolder = { pid: options.pid ?? process.pid, path: options.path ?? process.cwd(), since: now() };

	const release = (): void => {
		const reading = readGateLock(file);
		if (reading.kind !== "holder" || reading.holder.pid !== mine.pid) return;
		rmSync(file, { force: true });
	};

	if (placeLock(file, mine)) return { held: true, waitedMs: 0, holder: undefined, tookOver: undefined, release };

	const started = now();
	let announced = false;
	let waited: GateHolder | undefined;
	for (;;) {
		const reading = readGateLock(file);
		const holder = reading.kind === "holder" ? reading.holder : undefined;
		if (holder !== undefined && alive(holder.pid)) {
			waited = holder;
			const waitedMs = now() - started;
			if (waitedMs >= waitMs) {
				options.onGiveUp?.(holder, waitedMs);
				return { held: false, waitedMs, holder, tookOver: undefined, release };
			}
			if (!announced) {
				announced = true;
				options.onWait?.(holder);
			}
		} else {
			// Absent is the holder finishing; a dead holder or a file no gate wrote is stale.
			if (reading.kind !== "absent") rmSync(file, { force: true });
			if (placeLock(file, mine)) {
				if (reading.kind !== "absent") options.onTakeOver?.(holder);
				return { held: true, waitedMs: now() - started, holder: waited, tookOver: holder, release };
			}
		}
		await sleep(pollMs);
	}
}

/** Hold the machine's lock around `run`, and release it however `run` ends. */
export async function withGateLock<T>(options: GateLockOptions, run: () => Promise<T>): Promise<T> {
	if (options.skip === true) return run();
	const lock = await acquireGateLock(options);
	try {
		return await run();
	} finally {
		lock.release();
	}
}

/** How long a holder has had the machine, in whole seconds. */
function age(since: number, now: number): string {
	return `${Math.max(0, Math.round((now - since) / 1000))}s`;
}

/** The line a gate prints once when it waits: who holds the machine, and from where. */
export function waitingLine(holder: GateHolder, now: number = Date.now()): string {
	return `check: another check is running (pid ${holder.pid}, ${holder.path}, ${age(holder.since, now)}); waiting`;
}

/** The line a gate prints when it replaced a holder that was gone. */
export function takeOverLine(holder: GateHolder | undefined): string {
	return holder === undefined
		? "check: replaced an unreadable gate lock, which no holder could release"
		: `check: replaced a gate lock left by pid ${holder.pid}, which is no longer running`;
}

/** The line a gate prints when its wait ran out and it runs beside a live holder. */
export function giveUpLine(holder: GateHolder, waitedMs: number): string {
	const waited = `${Math.round(waitedMs / 1000)}s`;
	return `check: waited ${waited} for pid ${holder.pid} and is running beside it — a spawn in the test phase may be starved`;
}
