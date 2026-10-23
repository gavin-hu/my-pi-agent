/**
 * The pending-report coordinator: how a live feature tells the model what
 * happened without interrupting it.
 *
 * A watcher match, a finished job, and arriving mail follow one rule — report at
 * the next turn, and raise at most one triggered turn per burst when the work
 * opted into `wake`, as soon as the agent is idle. The three traps are subtle
 * enough to have been re-derived once per extension:
 *
 * - a wake is only safe while the agent is idle, so an outcome that arrives
 *   mid-turn is queued rather than sent, and `agent_settled` retries it;
 * - an outcome outlives the run it arrived in, so the retry asks
 *   `wakeRequested()` rather than trusting the one call that queued it;
 * - between the triggered send and the `agent_start` it causes, the agent still
 *   looks idle, so a second outcome in that window must not trigger a second
 *   turn. `waking` closes that window.
 *
 * Delivery is one shared transcript notice per burst, and a burst is marked
 * reported only after the send succeeded, so a throw leaves it for the next
 * turn. `registerPendingChannel` is the other half: the seven host hooks that
 * drive the machine, registered once for `job` and `watch` rather than copied
 * into each factory. Value-only: every flag lives in the returned closure, never
 * in a module variable, because each extension gets its own module instance.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	/**
	 * Whether any pending outcome asks for a triggered turn. Called by the settle
	 * retry, so a mid-turn outcome still wakes once the agent is idle.
	 */
	wakeRequested(): boolean;
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
	/** The turn settled: retry a wake it suppressed, unless it was aborted. */
	agentSettled(event?: { aborted?: boolean }): void;
	/** Report what is queued at the start of a turn, without triggering one. */
	beforeAgentStart(): { message: NoticeMessage } | undefined;
	/** Drop this source's older notices from the outgoing context. */
	filterContext(messages: readonly AgentMessage[]): { messages: AgentMessage[] } | undefined;
}

export function createPendingReporter<T>(options: PendingReporterOptions<T>): PendingReporter {
	const { wake, pending, markReported, buildNotice, wakeRequested, source, onWoke } = options;
	let busy = false;
	let waking = false;

	const report = (): void => {
		if (busy || waking) return;
		if (!wakeRequested()) return;
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
	};

	return {
		report,
		sessionStart: () => {
			busy = false;
			waking = false;
		},
		agentStart: () => {
			busy = true;
		},
		agentSettled: (event) => {
			busy = false;
			waking = false;
			// An interrupted run is not a request to interrupt again; its outcomes
			// stay queued for the next turn.
			if (event?.aborted === true) return;
			report();
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

/** The session-scoped state a channel drives, narrowed to what its hooks need. */
export interface PendingChannelRuntime {
	/**
	 * Load this session's records on every session start. A promise is awaited, so a
	 * runtime that resolves a repository or opens a store is fully loaded before the
	 * report trigger is armed.
	 */
	load(ctx: ExtensionContext): void | Promise<void>;
	/** Repaint the status chip; a runtime that publishes none omits it. */
	setStatus?(ctx: ExtensionContext): void;
	/** Release the session's resources; idempotent. */
	shutdown(): Promise<void>;
}

export interface PendingChannelOptions {
	/** The reporter that turns pending outcomes into notices. */
	reporter: PendingReporter;
	/** The runtime whose pending outcomes the notices describe. */
	runtime: PendingChannelRuntime;
	/** Runs on every session start, after the runtime loads: arm the report trigger. */
	onSessionStart?(ctx: ExtensionContext): void;
	/** Runs before the runtime releases: clear what `onSessionStart` armed. */
	onSessionShutdown?(): void;
}

/**
 * Wire a reporter to the host's session lifecycle.
 *
 * The order inside `session_start` is the contract: the reporter forgets the
 * previous session's busy window, the runtime loads the records, and only then
 * is the report trigger armed — a reload or a replaced session reuses the same
 * runtime. A shutdown clears the trigger before the runtime releases the table it
 * was calling into.
 */
export function registerPendingChannel(
	pi: Pick<ExtensionAPI, "on">,
	{ reporter, runtime, onSessionStart, onSessionShutdown }: PendingChannelOptions,
): void {
	pi.on("session_start", async (_event, ctx) => {
		reporter.sessionStart();
		await runtime.load(ctx);
		onSessionStart?.(ctx);
	});

	// Tree navigation does not change the pending records; only repaint.
	pi.on("session_tree", (_event, ctx) => {
		runtime.setStatus?.(ctx);
	});

	pi.on("agent_start", () => {
		reporter.agentStart();
	});
	pi.on("agent_settled", (event) => {
		reporter.agentSettled(event);
	});

	// Report what is queued at the start of the next turn, without triggering one.
	pi.on("before_agent_start", (_event, ctx) => {
		const reported = reporter.beforeAgentStart();
		if (!reported) return undefined;
		runtime.setStatus?.(ctx);
		return reported;
	});

	// Keep stale notices out of later turns. Only this source's notices are
	// pruned; another source's are left for its own handler.
	pi.on("context", (event) => reporter.filterContext(event.messages));

	pi.on("session_shutdown", async () => {
		onSessionShutdown?.();
		await runtime.shutdown();
	});
}
