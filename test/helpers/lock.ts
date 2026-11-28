/**
 * One test run per machine.
 *
 * A run spawns git, a shell, or a browser, and two of them at once starve each other's wall clocks:
 * on 2026-11-09 a spawned `git` ran past 55 s and a shell past 27.5 s, each green alone and on the
 * re-run, while another checkout was being checked. The contended resource is the CPU, so the lock is
 * one file for the machine rather than one per checkout.
 *
 * It is taken by the test preload (`./preload.ts`, registered in `bunfig.toml`), which is the one
 * hook that reaches `bun test`, `bun run check` and CI without a command anyone has to remember. The
 * claim is atomic — a temp file linked into place — so a waiting run never reads half a record.
 *
 * Two facts decide the rules, both measured on Bun 1.4.3:
 *
 * - The record is **left behind** by a finished run: bun's test process does not run `exit` handlers,
 *   so a release is best effort and liveness is what actually decides. A dead holder's file is taken
 *   over **silently**, because that is the ordinary path; only a file no run wrote is worth a line.
 * - A `--parallel` worker, or the same process re-evaluating the preload for the next file, must not
 *   wait on its own parent. The holder marks its children with `PI_LOCKED=1`, which an argument could
 *   not do — but that is not enough on its own: `--parallel` has Bun spawn the workers itself, so
 *   they never inherit the holder's mutation, and one run's four workers then queue on each other for
 *   {@link LOCK_WAIT_MS}. Measured on 1.4.3: `bun test --parallel=4 test/` parks with a worker holding
 *   the file, while the same sweep serial is 8.8 s and `PI_NO_LOCK=1 --parallel=4 test/` is 4.7 s. So
 *   the record carries the invocation's parent pid, `root`, and a worker whose own parent holds the
 *   lock shares it instead of waiting on it.
 *
 * The holder refreshes its record, so a pid the OS has since reused cannot hold the machine: a record
 * older than {@link LOCK_STALE_AFTER_MS} is stale however alive its pid looks.
 */

import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The lock file's name: one test run per machine, whichever checkouts started them. */
const LOCK_NAME = "my-pi-agent-test.lock";

/** How long a second run waits for a live holder before it runs beside it and says so. */
export const LOCK_WAIT_MS = 10 * 60_000;

/** How often a waiting run looks again while a holder is alive. */
export const LOCK_POLL_MS = 1_000;

/** How often the holder refreshes its record. */
export const LOCK_HEARTBEAT_MS = 30_000;

/** How old a record has to be before a waiting run calls it stale, whatever its pid says. */
export const LOCK_STALE_AFTER_MS = 5 * 60_000;

/** What a run records about itself: who has the machine, from where, since when, and which run. */
export interface LockHolder {
	pid: number;
	path: string;
	since: number;
	/**
	 * The invocation this holder belongs to, as its parent's pid.
	 *
	 * `bun test --parallel` spawns its workers itself, so a worker is a sibling of the process that
	 * holds the lock, not its child: the shared parent is the only thing a worker can compare. Absent
	 * in a record an older build wrote, which reads as another run and waits.
	 */
	root?: number;
}

/** One process's claim on the machine. */
export interface TestLock {
	/** Whether this run owns the lock; `false` after a wait it did not win, or a skip. */
	readonly held: boolean;
	/** Remove the lock when it is still ours. Safe to call more than once. */
	release: () => void;
}

/** How a run takes the lock; every seam is injectable so a case needs no second process. */
export interface LockOptions {
	/** Directory to keep the lock in; a case uses its own. */
	dir?: string;
	/** How long to wait for a live holder before running anyway. */
	waitMs?: number;
	/** How often to look again while waiting. */
	pollMs?: number;
	/** This process, as the lock records it. */
	pid?: number;
	/** Where this run was started, for the waiting line. */
	path?: string;
	/** The invocation this caller belongs to; the parent's pid unless a case says otherwise. */
	root?: number;
	/** Whether this caller is one of `--parallel`'s workers; the argv's own flag unless a case says. */
	worker?: boolean;
	now?: () => number;
	alive?: (pid: number) => boolean;
	sleep?: (ms: number) => Promise<void>;
	/** The environment the escapes are read from and `PI_LOCKED` is written to. */
	env?: Record<string, string | undefined>;
	/** Called once, the first time a live holder is found. */
	onWait?: (holder: LockHolder) => void;
	/** Called when a file no run wrote was replaced by ours. */
	onTakeOver?: () => void;
	/** Called when the wait ran out and this run continues beside the holder. */
	onGiveUp?: (holder: LockHolder, waitedMs: number) => void;
}

/** The lock file's path: the machine's temp directory unless a caller says otherwise. */
export function lockPath(dir: string = tmpdir()): string {
	return join(dir, LOCK_NAME);
}

/**
 * Whether a process is still running.
 *
 * `EPERM` is the interesting answer: the OS refuses a signal to a process that exists but belongs to
 * another user, which is alive, where `ESRCH` is a process that is gone.
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

/** What the lock file says right now: nothing, something no run wrote, or a holder. */
export type LockReading = { kind: "absent" } | { kind: "unreadable" } | { kind: "holder"; holder: LockHolder };

/**
 * Read the lock file.
 *
 * Absent and unreadable are different answers: a file that vanished means the holder finished, which
 * is this run's chance to start silently, while a file no run wrote is one nobody can release and has
 * to be replaced.
 */
export function readLock(file: string): LockReading {
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
	const record = value as Partial<Record<keyof LockHolder, unknown>>;
	const { pid, path, since, root } = record;
	if (typeof pid !== "number" || typeof path !== "string" || typeof since !== "number") {
		return { kind: "unreadable" };
	}
	// An optional field of the wrong shape is dropped rather than costing the record, so a file an
	// older build wrote reads as another run's — which is what makes it wait rather than share.
	return { kind: "holder", holder: { pid, path, since, ...(typeof root === "number" ? { root } : {}) } };
}

/**
 * Put a fresh lock in place, atomically.
 *
 * The temp file is written whole and then linked to the lock's name: a reader sees either no lock or
 * a complete one, and `link` refuses a name that exists, which is the claim itself.
 */
function claim(file: string, holder: LockHolder): boolean {
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
 * Take the machine's lock, waiting for a live holder.
 *
 * A holder that is gone, or a record older than the heartbeat can explain, is replaced rather than
 * waited on — silently, because a release that never ran is the ordinary path rather than a fault. A
 * live holder is waited for up to `waitMs`, announced once, and then run beside: a run that never
 * starts is worse than one that runs into contention it was told about.
 */
export async function acquireTestLock(options: LockOptions = {}): Promise<TestLock> {
	const env = options.env ?? process.env;
	const skipped: TestLock = { held: false, release: () => {} };
	if (env.PI_NO_LOCK === "1" || env.PI_LOCKED === "1") return skipped;

	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const alive = options.alive ?? processAlive;
	const file = lockPath(options.dir);
	const waitMs = options.waitMs ?? LOCK_WAIT_MS;
	const pollMs = options.pollMs ?? LOCK_POLL_MS;
	const mine: LockHolder = {
		pid: options.pid ?? process.pid,
		path: options.path ?? process.cwd(),
		since: now(),
		root: options.root ?? process.ppid,
	};
	// Bun names its own workers on their command line, so a worker knows what it is.
	const worker = options.worker ?? process.argv.includes("--test-worker");

	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const release = (): void => {
		if (heartbeat !== undefined) clearInterval(heartbeat);
		const reading = readLock(file);
		if (reading.kind !== "holder" || reading.holder.pid !== mine.pid) return;
		rmSync(file, { force: true });
	};
	const taken = (): TestLock => {
		// The escape for a child: `--parallel` workers and a re-evaluated preload both inherit it.
		env.PI_LOCKED = "1";
		// Best effort — bun's test process may not run the exit handler this is wired to — so the
		// refresh is what keeps a reused pid from inheriting the machine.
		heartbeat = setInterval(() => {
			const refreshed = { ...mine, since: now() };
			if (readLock(file).kind === "holder") writeFileSync(file, `${JSON.stringify(refreshed)}\n`);
		}, LOCK_HEARTBEAT_MS);
		heartbeat.unref?.();
		return { held: true, release };
	};

	if (claim(file, mine)) return taken();

	const started = now();
	let announced = false;
	for (;;) {
		const reading = readLock(file);
		const holder = reading.kind === "holder" ? reading.holder : undefined;
		const stale = holder === undefined || !alive(holder.pid) || now() - holder.since > LOCK_STALE_AFTER_MS;
		if (holder !== undefined && !stale) {
			// This run's own worker: the invocation already holds the machine, and waiting on it is
			// waiting on ourselves. Never announced, because a run that queues behind itself is a
			// defect rather than contention a reader should be told about.
			if (worker && holder.root === mine.root) return skipped;
			const waitedMs = now() - started;
			if (waitedMs >= waitMs) {
				options.onGiveUp?.(holder, waitedMs);
				return { held: false, release };
			}
			if (!announced) {
				announced = true;
				options.onWait?.(holder);
			}
		} else {
			// Absent is the holder finishing; a dead holder or a file no run wrote is stale.
			if (reading.kind !== "absent") rmSync(file, { force: true });
			if (claim(file, mine)) {
				if (reading.kind === "unreadable") options.onTakeOver?.();
				return taken();
			}
		}
		await sleep(pollMs);
	}
}

/** How long a holder has had the machine, in whole seconds. */
function age(since: number, now: number): string {
	return `${Math.max(0, Math.round((now - since) / 1000))}s`;
}

/** The line a run prints once when it waits: who holds the machine, and for how long. */
export function waitingLine(holder: LockHolder, now: number = Date.now()): string {
	return `test lock: waiting for pid ${holder.pid} (${holder.path}, ${age(holder.since, now)}) — a second run on this machine starves the first one's spawns`;
}

/** The line a run prints when it replaced a file no run wrote. */
export function takeOverLine(): string {
	return "test lock: replaced a lock file no run wrote, which nothing could release";
}

/**
 * The line a run prints when its wait ran out and it continues beside a live holder.
 *
 * This is the one outcome where two runs believe they are alone, so it names the lapse and the two
 * things a reader can do about it rather than reporting a wait.
 */
export function giveUpLine(holder: LockHolder, waitedMs: number): string {
	const waited = `${Math.max(0, Math.round(waitedMs / 1000))}s`;
	return `test lock: waited ${waited} for pid ${holder.pid} and is running beside it — the one-run guarantee has lapsed and a spawn here may be starved; kill the other run, or \`PI_NO_LOCK=1\` if running beside it was intended`;
}
