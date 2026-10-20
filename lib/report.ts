/**
 * The pending-report coordinator: how a live feature tells the model what
 * happened without interrupting it.
 *
 * A watcher match and a finished job follow one rule — report at the next turn,
 * and raise at most one triggered turn when the work opted into `wake`. The two
 * traps are subtle enough to have been re-derived once per extension:
 *
 * - a wake is only safe while the agent is idle, so an outcome that arrives
 *   mid-turn must be queued rather than sent;
 * - between the triggered send and the `agent_start` it causes, the agent still
 *   looks idle, so a second outcome in that window must not trigger a second
 *   turn. `waking` closes that window.
 *
 * Delivery is one shared transcript notice per burst, and a burst is marked
 * reported only after the send succeeded, so a throw leaves it for the next
 * turn. Value-only: every flag lives in the returned closure, never in a module
 * variable, because each extension gets its own module instance.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { pruneStaleNotices, type NoticeMessage } from "./notice.ts";

export interface PendingReporterOptions<T> {
	/** Send a notice and ask the host to start one turn for it. */
	wake(notice: NoticeMessage): void;
	/** The outcomes not yet reported, oldest first. Does not mark them. */
	pending(): T[];
	/** Mark outcomes as reported, once the send has succeeded. */
	markReported(items: T[]): void;
	/** Build the notice for one burst: model text plus renderer details. */
	buildNotice(items: T[]): NoticeMessage;
	/** The notice's source, so only its own stale entries are pruned. */
	source: string;
	/** Runs after a wake turn was successfully requested, for an extra announcement. */
	onWoke?(items: T[]): void;
}

/** The handlers an extension wires into its lifecycle hooks. */
export interface PendingReporter {
	/** An outcome arrived: wake a turn if the agent is idle, else leave it queued. */
	report(): void;
	/** A new session starts idle. */
	sessionStart(): void;
	/** A turn began: outcomes queue up, and none of them triggers a turn. */
	agentStart(): void;
	/** The turn settled: a later outcome may wake again. */
	agentSettled(): void;
	/** Report what is queued at the start of a turn, without triggering one. */
	beforeAgentStart(): { message: NoticeMessage } | undefined;
	/** Drop this source's older notices from the outgoing context. */
	filterContext(messages: readonly AgentMessage[]): { messages: AgentMessage[] } | undefined;
}

export function createPendingReporter<T>(options: PendingReporterOptions<T>): PendingReporter {
	const { wake, pending, markReported, buildNotice, source, onWoke } = options;
	let busy = false;
	let waking = false;

	return {
		report: () => {
			if (busy || waking) return;
			const items = pending();
			if (items.length === 0) return;
			try {
				wake(buildNotice(items));
			} catch {
				// Reporting is best-effort; the next turn reports the same items.
				return;
			}
			// Mark only after the send succeeded, so a throw changes nothing.
			markReported(items);
			waking = true;
			onWoke?.(items);
		},
		sessionStart: () => {
			busy = false;
			waking = false;
		},
		agentStart: () => {
			busy = true;
		},
		agentSettled: () => {
			busy = false;
			waking = false;
		},
		beforeAgentStart: () => {
			const items = pending();
			if (items.length === 0) return undefined;
			const notice = buildNotice(items);
			markReported(items);
			return { message: notice };
		},
		filterContext: (messages) => {
			const pruned = pruneStaleNotices(messages, source);
			return pruned ? { messages: pruned } : undefined;
		},
	};
}
