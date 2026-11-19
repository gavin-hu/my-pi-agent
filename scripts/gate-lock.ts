/**
 * The gate's lock: one `bun run check` at a time across this repository's worktrees.
 *
 * Three panes gating at once turn browser suites into timeouts that are not defects — a 30,000 ms
 * case in a file the card never touched, and a second full run to show it was the machine. The
 * stagger that follows is etiquette between people, so this is the same rule as a lock: a gate
 * that arrives second says who holds the box and waits, rather than starving the run already
 * going.
 *
 * The file lives in the **main checkout's** cache (`<main>/.pi/cache/check.lock`), found through
 * `git rev-parse --git-common-dir`, so every worktree of one repository queues on it and another
 * repository's gate does not. Nothing a run writes there can reach `git status`.
 */

import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Who is gating, as the file records it. */
export interface GateHolder {
	pid: number;
	/** ISO time the run took the lock. */
	startedAt: string;
}

/** A held lock, and the release that gives it back. */
export interface GateLock {
	/** The lock file's own path, for a message or a person clearing it. */
	path: string;
	holder: GateHolder;
	/** Idempotent, and only for the process that took it. */
	release(): void;
}

export interface AcquireOptions {
	/** Where to resolve the repository from; defaults to this process's directory. */
	cwd?: string;
	/** How long to queue before refusing, in ms. Short enough to read as a refusal. */
	waitMs?: number;
	/** How often the wait says it is still waiting, in ms. */
	reportMs?: number;
	/** How often the file is asked again, in ms. */
	pollMs?: number;
	/** Wall-clock seam; defaults to the real clock. */
	now?: () => number;
	/** One line per report or reclaim; defaults to stderr. */
	log?: (line: string) => void;
	/** The wait between polls; a seam for the cases. */
	sleep?: (ms: number) => void;
}

/** What every line this module prints starts with, so one of them is greppable. */
export const GATE_PREFIX = "check-lock:";

const DEFAULT_WAIT_MS = 20 * 60_000;
const DEFAULT_REPORT_MS = 30_000;
const DEFAULT_POLL_MS = 250;

/** Set by a run that already holds the lock, so a suite shelling out to its own gate does not wait on it. */
const NESTED_ENV = "PI_GATE_HELD";

/**
 * Where the lock lives: the main checkout's cache, so worktrees share one and git ignores it.
 *
 * A directory that is not a repository is its own scope, which is what the cases use and what a
 * copied tarball would get.
 */
export function gateLockPath(cwd: string = process.cwd()): string {
	const found = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" });
	// `--git-common-dir` is the main worktree's `.git`, absolute in a worktree and relative in the
	// checkout, so the repository's root is that path's parent. A directory that is not a repository
	// is its own root — the parent of an arbitrary directory would be a neighbour's lock.
	const inside = found.status === 0 ? resolve(cwd, (found.stdout ?? "").trim()) : undefined;
	const root = inside === undefined ? resolve(cwd) : dirname(inside);
	return join(root, ".pi", "cache", "check.lock");
}

/** The holder a file records, or undefined when it cannot be read as one. */
function holderIn(path: string): GateHolder | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const { pid, startedAt } = parsed as Partial<GateHolder>;
		if (typeof pid !== "number" || typeof startedAt !== "string") return undefined;
		return { pid, startedAt };
	} catch {
		return undefined;
	}
}

/** Whether a process answers on this machine, which is the only liveness a lock can ask for. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Try to take the file; the one caller retries when it is taken. */
function take(path: string, at: number): GateHolder | undefined {
	try {
		const fd = openSync(path, "wx");
		const holder: GateHolder = { pid: process.pid, startedAt: new Date(at).toISOString() };
		writeSync(fd, JSON.stringify(holder));
		closeSync(fd);
		return holder;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return undefined;
	}
}

function minutes(ms: number): string {
	const left = Math.max(0, Math.round(ms / 60_000));
	return left === 1 ? "1 minute" : `${left} minutes`;
}

/**
 * Take the gate's lock, waiting for whichever pane holds it.
 *
 * Returns `undefined` for a nested run: the lock's only escape is the one a suite needs when it
 * shells out to `bun run check` from inside a gate, and it is not a knob for a person, because a
 * lock a person can skip is not a queue.
 */
export function acquireGate(options: AcquireOptions = {}): GateLock | undefined {
	if (process.env[NESTED_ENV] === "1") return undefined;
	const log = options.log ?? ((line: string) => console.error(line));
	const now = options.now ?? (() => Date.now());
	const sleep =
		options.sleep ??
		((ms: number) => {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
		});
	const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
	const reportMs = options.reportMs ?? DEFAULT_REPORT_MS;
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
	const path = gateLockPath(options.cwd);
	mkdirSync(dirname(path), { recursive: true });

	const deadline = now() + waitMs;
	let said = "";
	let saidAt = 0;
	for (;;) {
		const holder = take(path, now());
		if (holder !== undefined) {
			process.env[NESTED_ENV] = "1";
			return {
				path,
				holder,
				release: () => {
					// Only the owner gives it back: a waiter that timed out must not delete the holder's.
					if (holderIn(path)?.pid === holder.pid) rmSync(path, { force: true });
					// A child spawned after the gate is released is not nested in it, so the marker goes
					// with the lock rather than outliving it.
					if (process.env[NESTED_ENV] === "1") delete process.env[NESTED_ENV];
				},
			};
		}
		const current = holderIn(path);
		// A pid that answers is gating; one that does not left a lock behind (a killed run) and the
		// next gate takes it, saying so rather than inheriting a mystery.
		if (current !== undefined && !alive(current.pid)) {
			log(`${GATE_PREFIX} reclaiming the lock pid ${current.pid} left (gating since ${current.startedAt})`);
			rmSync(path, { force: true });
			continue;
		}
		const line =
			current === undefined
				? `${GATE_PREFIX} waiting — ${path} is being taken or cleared`
				: `${GATE_PREFIX} waiting for pid ${current.pid} (gating since ${current.startedAt}); ${minutes(deadline - now())} left before this gives up on ${path}`;
		if (line !== said || now() - saidAt >= reportMs) {
			log(line);
			said = line;
			saidAt = now();
		}
		if (now() >= deadline) {
			throw new Error(
				`${GATE_PREFIX} ${path} is still held by pid ${current?.pid ?? "unknown"} (since ${current?.startedAt ?? "unknown"}); nothing ran. Delete that file if the pane is gone.`,
			);
		}
		sleep(pollMs);
	}
}
