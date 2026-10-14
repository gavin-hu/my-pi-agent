/**
 * job — manage long-running background shell commands.
 *
 * Registers the `job` tool and `/jobs` command. Jobs run as detached shell
 * processes with their output streamed to log files; the status chip shows
 * running and unreported-failure counts, and finished jobs are reported to the
 * model at the next turn (or, for `wake` jobs, by triggering one turn).
 *
 * Load with:  pi --extension ./extensions/job
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { JOB_FINISHED_CHANNEL, type JobFinishedEvent } from "../../lib/events.ts";
import { STATUS_KEYS } from "../../lib/ui.ts";
import { registerCommands } from "./commands.ts";
import { formatCompletion } from "./format.ts";
import { createJobsRuntime, type JobsRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { Job, JobRecord } from "./types.ts";

/** Marker embedded in the injected completion context. */
const JOB_CONTEXT_MARKER = "[BACKGROUND JOBS]";

/** Custom-entry type used for the injected completion message. */
export const JOB_CONTEXT_TYPE = "job-context";

function buildContext(jobs: JobRecord[]): string {
	const lines = jobs.map((job) => formatCompletion(job));
	return `${JOB_CONTEXT_MARKER}\n${jobs.length} background job${jobs.length === 1 ? "" : "s"} finished:\n${lines.join("\n")}\nRun \`job logs <id>\` for output.`;
}

function isJobContext(message: AgentMessage): boolean {
	return (message as AgentMessage & { customType?: string }).customType === JOB_CONTEXT_TYPE;
}

/** Trim a finished record to the fields the event bus carries. */
function toFinishedEvent(job: JobRecord): JobFinishedEvent {
	return {
		id: job.id,
		label: job.label,
		status: job.status === "running" ? "unknown" : job.status,
		exitCode: job.exitCode,
		signal: job.signal,
	};
}

export interface JobsDeps {
	/** Overridable runtime, so tests can drive events without spawning. */
	runtime?: JobsRuntime;
}

export default function jobs(pi: ExtensionAPI, deps: JobsDeps = {}): void {
	if (!isExtensionEnabled("job")) return;
	const runtime = deps.runtime ?? createJobsRuntime();
	let busy = false;

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	// Opt-in wake: a `wake` job finished while the agent is idle. Report *all*
	// pending completions, not just the waking one, so a non-wake job that
	// finished earlier is not silently marked seen and dropped.
	const handleFinish = (_job: Job): void => {
		if (busy) return;
		const pending = runtime.pendingCompletions();
		if (pending.length === 0) return;
		try {
			pi.sendMessage(
				{ customType: JOB_CONTEXT_TYPE, content: buildContext(pending), display: false },
				{ triggerTurn: true },
			);
			// Mark only once the send succeeded; a throw leaves them for the next turn.
			runtime.markReported(pending.map((job) => job.id));
		} catch {
			// Waking is best-effort; the next turn still reports the completion.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		busy = false;
		runtime.load(ctx);
		// `shutdown` clears this; a reload or session replacement reuses the
		// runtime, so re-arm it on every session start.
		runtime.onFinish = handleFinish;
		// Notify-listening extensions follow completions on the shared bus; the
		// runtime only knows the callback, never the channel.
		runtime.onComplete = (job) => {
			try {
				pi.events.emit(JOB_FINISHED_CHANNEL, toFinishedEvent(job));
			} catch {
				// The event bus is optional.
			}
		};
	});

	// Tree navigation does not change the process table; only repaint.
	pi.on("session_tree", (_event, ctx) => {
		runtime.setStatus(ctx);
	});

	pi.on("agent_start", () => {
		busy = true;
	});
	pi.on("agent_settled", () => {
		busy = false;
	});

	// Report completions to the model at the start of the next turn.
	pi.on("before_agent_start", (_event, ctx) => {
		const pending = runtime.pendingCompletions();
		if (pending.length === 0) return undefined;
		runtime.markReported(pending.map((job) => job.id));
		runtime.setStatus(ctx);
		return {
			message: { customType: JOB_CONTEXT_TYPE, content: buildContext(pending), display: false },
		};
	});

	// Keep stale completion notes out of later turns.
	pi.on("context", (event) => {
		const contexts = event.messages.filter(isJobContext);
		if (contexts.length <= 1) return undefined;
		const last = contexts[contexts.length - 1];
		return { messages: event.messages.filter((message) => !isJobContext(message) || message === last) };
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		runtime.onFinish = undefined;
		runtime.onComplete = undefined;
		await runtime.shutdown();
		try {
			ctx.ui.setStatus(STATUS_KEYS.jobs, undefined);
			ctx.ui.setStatus(STATUS_KEYS.jobsFailure, undefined);
		} catch {
			// UI may already be gone.
		}
	});
}
