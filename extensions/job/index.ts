/**
 * job — manage long-running background shell commands.
 *
 * Registers the `job` tool and `/jobs` command. Jobs run as detached shell
 * processes with their output streamed to log files; the status chip shows
 * running and unreported-failure counts, and finished jobs are reported to the
 * model — and shown as a bytefly notice — at the next turn, or by triggering one
 * turn for a `wake` job.
 *
 * Load with:  pi --extension ./extensions/job
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { JOB_FINISHED_CHANNEL, type JobFinishedEvent } from "../../lib/events.ts";
import { noticeMessage, type NoticeMessage, pruneStaleNotices } from "../../lib/notice.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { registerCommands } from "./commands.ts";
import { formatCompletion, jobOutcome, shortLabel } from "./format.ts";
import { createJobsRuntime, type JobsRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { Job, JobRecord } from "./types.ts";

/** Marker embedded in the injected completion context. */
const JOB_CONTEXT_MARKER = "[BACKGROUND JOBS]";

function buildContext(jobs: JobRecord[]): string {
	const lines = jobs.map((job) => formatCompletion(job));
	return `${JOB_CONTEXT_MARKER}\n${jobs.length} background job${jobs.length === 1 ? "" : "s"} finished:\n${lines.join("\n")}\nRun \`job logs <id>\` for output.`;
}

/** The shared notice for pending completions: model text plus renderer details. */
function jobNotice(jobs: JobRecord[]): NoticeMessage {
	const count = jobs.length;
	return noticeMessage({
		content: buildContext(jobs),
		details: {
			source: "job",
			title: `${count} background job${count === 1 ? "" : "s"} finished`,
			items: jobs.map((job) => ({
				label: `${job.id} ${shortLabel(job)}`,
				detail: jobOutcome(job),
				severity: job.status === "failed" ? "bad" : job.status === "exited" ? "ok" : "warn",
			})),
		},
	});
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
			pi.sendMessage(jobNotice(pending), { triggerTurn: true });
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
		return { message: jobNotice(pending) };
	});

	// Keep stale completion notices out of later turns. Only this extension's
	// notices are pruned; another source's are left for its own handler.
	pi.on("context", (event) => {
		const pruned = pruneStaleNotices(event.messages, "job");
		return pruned ? { messages: pruned } : undefined;
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
