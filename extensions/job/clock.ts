/**
 * The job runtime's periodic work: the repaint clock, and the sweep that polls
 * the jobs this session reattached.
 *
 * The clock is the only periodic hook the runtime arms. While a job runs it
 * re-asserts the footer chip, touches this session's liveness marker, and lets
 * the runtime poll the jobs it reattached; without it, anything that clears
 * extension statuses (a session reload, another UI path) would hide a
 * still-running job's chip until the next transition.
 *
 * Every fact it acts on is the caller's and arrives as a function: whether a job
 * is running, whether the runtime was disposed, what a tick does, and what a
 * repaint does. Nothing here holds state across calls — the armed timer lives in
 * the returned closure, never at module scope, because Pi loads each extension
 * with its own module cache.
 *
 * The sweep is here because it is the tick's work: a reattached job has no
 * `close` event, so only a periodic pass can notice that its pid is gone.
 */

import { defaultInterval, type RepeatTimer } from "../../lib/timer.ts";
import type { Job, JobRecord, JobStatus } from "./types.ts";

export interface RepaintClockDeps {
	/** The repaint interval, read when the clock is armed. */
	repaintMs: () => number;
	/** Whether any record is running, which is the only thing that keeps the clock armed. */
	running: () => boolean;
	/** Whether the runtime was shut down; a disposed runtime arms nothing. */
	disposed: () => boolean;
	/** Refresh this session's liveness marker. */
	touchMarker: () => void;
	/** One tick: the external poll and the chip re-assert. */
	tick: () => void;
	/** One repaint of the surface. */
	repaint: () => void;
	/** The repeating timer, injectable so a test ticks by hand instead of waiting. */
	interval?: RepeatTimer;
}

export interface RepaintClock {
	/** Arm the clock when a job is running and none is armed, and stop it when nothing is. */
	ensure(): void;
	/** Cancel a pending tick. */
	stop(): void;
	/** Ensure the clock, touch the marker, then repaint — unless the runtime is disposed. */
	paint(): void;
}

export function createRepaintClock(deps: RepaintClockDeps): RepaintClock {
	const interval = deps.interval ?? defaultInterval;
	let cancel: (() => void) | undefined;

	const stop = (): void => {
		cancel?.();
		cancel = undefined;
	};

	const ensure = (): void => {
		if (deps.disposed() || !deps.running()) {
			stop();
			return;
		}
		if (cancel) return;
		cancel = interval(deps.repaintMs(), () => deps.tick());
	};

	const paint = (): void => {
		ensure();
		deps.touchMarker();
		if (deps.disposed()) return;
		deps.repaint();
	};

	return { ensure, stop, paint };
}

/** What the sweep asks of the table; every decision it makes is answered there. */
export interface ExternalSweepDeps {
	/** Every record in the table. */
	records: () => Iterable<Job>;
	/** This session's id, so a peer's record is told from one's own. */
	sessionId: () => string;
	/**
	 * Whether the session that owns a record is still here: `live` and `quiet` both count,
	 * because a heartbeat only ticks while a job runs.
	 */
	ownerPresent: (sessionId: string) => boolean;
	/** Whether a pid is still running. */
	alive: (pid: number) => boolean;
	/** Whether a persisted start-time token still matches the pid it names. */
	owns: (job: JobRecord) => boolean;
	/** Settle a record whose process is gone; false when it cannot be judged. */
	settleGone: (job: Job) => boolean;
	/** Move a record to a settled status, resolving its waiters. */
	settle: (job: Job, patch: { status: JobStatus; signal?: string | null }) => void;
	/** SIGTERM a pid. */
	signal: (pid: number) => void;
	/** Refresh this session's liveness marker. */
	touchMarker: () => void;
	/** Prune finished records, persist, and repaint, after something changed. */
	changed: () => void;
}

/**
 * Poll the reattached (unowned) jobs once: settle any whose pid is gone, and reap
 * an abandoned non-detached process whose owner session is gone.
 */
export function createExternalSweep(deps: ExternalSweepDeps): () => void {
	return () => {
		deps.touchMarker();
		let changed = false;
		for (const job of deps.records()) {
			if (job.status !== "running" || job.owned) continue;
			const peer = job.sessionId !== deps.sessionId();
			// A peer that is still here owns this job, a quiet one included: leave its state to
			// that owner. The peer's id is asked however often the record says it is not ours.
			if (peer && deps.ownerPresent(job.sessionId)) continue;
			if (job.pid === null || !deps.alive(job.pid)) {
				// A record with no pid cannot be judged gone; leave it alone rather than
				// announcing on every tick.
				if (!deps.settleGone(job)) continue;
				changed = true;
				continue;
			}
			// The owner is gone and the job is not detached: reap the abandoned
			// process, guarding against pid reuse with the start token. A settle is the
			// whole announcement, so the reap needs no second call of its own.
			if (peer && !job.detached) {
				if (deps.owns(job)) {
					deps.signal(job.pid);
					deps.settle(job, { status: "killed", signal: "SIGTERM" });
				} else {
					deps.settle(job, { status: "unknown" });
				}
				changed = true;
			}
		}
		if (!changed) return;
		deps.changed();
	};
}
