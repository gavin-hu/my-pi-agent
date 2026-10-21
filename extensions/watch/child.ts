/**
 * A command watcher's process lifecycle: spawn, tree-kill, escalate, and drain.
 *
 * A command source is a spawned process whose merged stdout and stderr feed the
 * matcher. This module owns the process side only — the spawn, the SIGTERM →
 * SIGKILL grace, and the shutdown drain — over the injected `SpawnFn` and
 * `KillTreeFn` seams, so the runtime keeps the watcher's status, its repaint,
 * and its clock.
 *
 * Value-only: the child handle and its escalation timer live on the caller's
 * slot, never here, because Pi loads each extension with its own module cache.
 */

import { defaultKillTree, defaultSpawn, type KillTreeFn, type SpawnFn, type SpawnedProcess } from "../../lib/spawn.ts";

/** Grace period before a stopped command is escalated to SIGKILL. */
export const KILL_GRACE_MS = 2000;

/**
 * The process fields a watcher record carries. The supervisor mutates them in
 * place, so the runtime's record and the module's handle cannot disagree about
 * whether a child is still live.
 */
export interface ChildSlot {
	pid?: number;
	child?: SpawnedProcess;
	killTimer?: ReturnType<typeof setTimeout>;
}

/** How a child settled, for the sink that owns the watcher's status transition. */
export type ChildOutcome =
	| { kind: "closed"; code: number | null; signal: string | null }
	| { kind: "failed"; message: string };

export interface ChildSink {
	/** One chunk of merged stdout/stderr. */
	onData(chunk: Buffer): void;
	/**
	 * The child closed or failed to spawn. The sink owns the status, because only
	 * it knows whether the watcher was still running when that happened.
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
	/** Spawn `command`, or return the spawn error and leave the slot's child unset. */
	start(slot: ChildSlot, command: string, cwd: string, sink: ChildSink): string | undefined;
	/** SIGTERM a command, escalating to SIGKILL when it has not closed in time. */
	terminate(slot: ChildSlot): void;
	/** Kill immediately, without arming an escalation. */
	kill(slot: ChildSlot, signal: "SIGTERM" | "SIGKILL"): void;
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

	const kill = (slot: ChildSlot, signal: "SIGTERM" | "SIGKILL"): void => {
		const pid = slot.pid;
		try {
			if (pid !== undefined) killTree(pid, signal, signal === "SIGKILL");
			else slot.child?.kill(signal);
		} catch {
			// Best-effort: the child may already be gone.
		}
	};

	const terminate = (slot: ChildSlot): void => {
		clearTimer(slot);
		kill(slot, "SIGTERM");
		if (slot.pid === undefined && !slot.child) return;
		slot.killTimer = setTimeout(() => {
			slot.killTimer = undefined;
			if (slot.child) kill(slot, "SIGKILL");
		}, graceMs);
		slot.killTimer.unref?.();
	};

	const start = (slot: ChildSlot, command: string, cwd: string, sink: ChildSink): string | undefined => {
		let child: SpawnedProcess;
		try {
			child = spawnFn(command, { cwd });
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
