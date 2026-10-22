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
import { noticeMessage, type NoticeMessage } from "../../lib/notice.ts";
import { createPendingReporter, registerPendingChannel } from "../../lib/report.ts";
import { registerCommands } from "./commands.ts";
import { formatCompletion, jobOutcome, shortLabel } from "./format.ts";
import { createJobsRuntime, type JobsRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import type { JobRecord } from "./types.ts";

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

	// Opt-in wake: a `wake` job finished while the agent is idle. The reporter
	// reports *all* pending completions, not just the waking one, so a job that
	// finished earlier is not silently marked seen and dropped.
	const reporter = createPendingReporter<JobRecord>({
		wake: (notice) => pi.sendMessage(notice, { triggerTurn: true }),
		pending: () => runtime.pendingCompletions(),
		markReported: (records) => runtime.markReported(records.map((job) => job.id)),
		buildNotice: jobNotice,
		source: "job",
	});

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	registerPendingChannel(pi, {
		reporter,
		runtime,
		// `shutdown` clears these; a reload or session replacement reuses the
		// runtime, so re-arm them on every session start.
		onSessionStart: () => {
			runtime.onFinish = () => reporter.report();
			// Notify-listening extensions follow completions on the shared bus; the
			// runtime only knows the callback, never the channel.
			runtime.onComplete = (job) => {
				try {
					pi.events.emit(JOB_FINISHED_CHANNEL, toFinishedEvent(job));
				} catch {
					// The event bus is optional.
				}
			};
		},
		onSessionShutdown: () => {
			runtime.onFinish = undefined;
			runtime.onComplete = undefined;
		},
	});
}
