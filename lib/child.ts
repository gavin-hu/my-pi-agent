/**
 * A spawned command's lifecycle: spawn, tree-kill, escalate, and drain.
 *
 * A `job` or a `watch` command source is a process whose merged stdout and
 * stderr feed its owner. This module owns the process side only — the spawn, the
 * SIGTERM → SIGKILL grace, and the shutdown drain — over the injected `SpawnFn`
 * and `KillTreeFn` seams, so each owner keeps its own status, repaint, and clock.
 * The escalation has one body and one default (`KILL_GRACE_MS`); each owner passes
 * its configured grace, so `job` escalates at its `killGraceMs` and `watch` at its
 * own, and neither re-implements the SIGTERM → SIGKILL step.
 *
 * Value-only: the child handle and its escalation timer live on the caller's
 * slot, never here, because Pi loads each extension with its own module cache.
 */

import {
	defaultKillTree,
	defaultSpawn,
	type KillTreeFn,
	type SpawnFn,
	type SpawnedProcess,
	type SpawnOptions,
} from "./spawn.ts";

/** Grace period before a stopped command is escalated to SIGKILL. */
export const KILL_GRACE_MS = 2000;

/**
 * The process fields a caller's record carries. The supervisor mutates them in
 * place, so the runtime's record and the module's handle cannot disagree about
 * whether a child is still live.
 */
export interface ChildSlot {
	pid?: number;
	child?: SpawnedProcess;
	killTimer?: ReturnType<typeof setTimeout>;
}

/** How a child settled, for the sink that owns the caller's status transition. */
export type ChildOutcome =
	| { kind: "closed"; code: number | null; signal: string | null }
	| { kind: "failed"; message: string };

export interface ChildSink {
	/** One chunk of merged stdout/stderr. */
	onData(chunk: Buffer): void;
	/**
	 * The child closed or failed to spawn. The sink owns the status, because only
	 * it knows whether the job or watcher was still running when that happened.
	 */
	onSettled(outcome: ChildOutcome): void;
}

export interface ChildSupervisorOptions {
	spawn?: SpawnFn;
	killTree?: KillTreeFn;
	/** Grace before SIGTERM escalates to SIGKILL; default {@link KILL_GRACE_MS}. */
	graceMs?: number;
}

export interface ChildSupervisor {
	/**
	 * Spawn `command` with the caller's options, or return the spawn error and
	 * leave the slot's child unset. The child is readable as `slot.child`.
	 */
	start(slot: ChildSlot, command: string, options: SpawnOptions, sink: ChildSink): string | undefined;
	/**
	 * Send `signal` (SIGTERM by default) and escalate to SIGKILL when the command
	 * has not closed within the grace. A SIGKILL was already final, so it is not
	 * escalated.
	 */
	terminate(slot: ChildSlot, signal?: NodeJS.Signals): void;
	/** Signal now, without arming an escalation. */
	kill(slot: ChildSlot, signal: NodeJS.Signals): void;
	/** Cancel a pending escalation. */
	clearTimer(slot: ChildSlot): void;
	/** Resolve when every slot's child has closed, or after `ms`, whichever comes first. */
	wait(slots: readonly ChildSlot[], ms: number): Promise<void>;
}

export function createChildSupervisor(options: ChildSupervisorOptions = {}): ChildSupervisor {
	const spawnFn = options.spawn ?? defaultSpawn;
	const killTree = options.killTree ?? defaultKillTree;
	const graceMs = options.graceMs ?? KILL_GRACE_MS;

	const clearTimer = (slot: ChildSlot): void => {
		if (slot.killTimer) {
			clearTimeout(slot.killTimer);
			slot.killTimer = undefined;
		}
	};

	const kill = (slot: ChildSlot, signal: NodeJS.Signals): void => {
		const pid = slot.pid;
		try {
			if (pid !== undefined) killTree(pid, signal, signal === "SIGKILL");
			else slot.child?.kill(signal);
		} catch {
			// Best-effort: the child may already be gone.
		}
	};

	const terminate = (slot: ChildSlot, signal: NodeJS.Signals = "SIGTERM"): void => {
		clearTimer(slot);
		kill(slot, signal);
		// A SIGKILL is already final: arming an escalation behind it would only fire against
		// a slot that is about to be cleared, and the doc above says it does not.
		if (signal === "SIGKILL") return;
		if (slot.pid === undefined && !slot.child) return;
		slot.killTimer = setTimeout(() => {
			slot.killTimer = undefined;
			if (slot.child) kill(slot, "SIGKILL");
		}, graceMs);
		slot.killTimer.unref?.();
	};

	const start = (slot: ChildSlot, command: string, options: SpawnOptions, sink: ChildSink): string | undefined => {
		let child: SpawnedProcess;
		try {
			child = spawnFn(command, options);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		slot.child = child;
		slot.pid = child.pid;
		const onData = (chunk: Buffer): void => sink.onData(chunk);
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("close", (code, signal) => {
			clearTimer(slot);
			slot.child = undefined;
			sink.onSettled({ kind: "closed", code, signal });
		});
		child.on("error", (error) => {
			clearTimer(slot);
			slot.child = undefined;
			sink.onSettled({ kind: "failed", message: error.message });
		});
		return undefined;
	};

	const wait = (slots: readonly ChildSlot[], ms: number): Promise<void> => {
		const alive = slots.filter((slot) => slot.child !== undefined);
		if (alive.length === 0) return Promise.resolve();
		return new Promise((resolve) => {
			let remaining = alive.length;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (): void => {
				if (--remaining > 0) return;
				if (timer !== undefined) clearTimeout(timer);
				resolve();
			};
			for (const slot of alive) {
				let done = false;
				const once = (): void => {
					if (done) return;
					done = true;
					settle();
				};
				slot.child?.on("close", once);
				slot.child?.on("error", once);
			}
			timer = setTimeout(resolve, ms);
			timer.unref?.();
		});
	};

	return { start, terminate, kill, clearTimer, wait };
}
