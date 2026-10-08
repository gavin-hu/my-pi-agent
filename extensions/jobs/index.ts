/**
 * jobs — manage long-running background shell commands.
 *
 * Registers the `job` tool and `/jobs` command. Jobs run as detached shell
 * processes with their output streamed to log files; the status chip shows
 * running and unreported-failure counts, and finished jobs are reported to the
 * model at the next turn (or, for `wake` jobs, by triggering one turn).
 *
 * Load with:  pi --extension ./extensions/jobs
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STATUS_KEYS } from "../_shared/ui.ts";
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

export interface JobsDeps {
	/** Overridable runtime, so tests can drive events without spawning. */
	runtime?: JobsRuntime;
}

export default function jobs(pi: ExtensionAPI, deps: JobsDeps = {}): void {
	const runtime = deps.runtime ?? createJobsRuntime();
	let busy = false;

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	/** Drain every unreported completion; returns them so the caller can report. */
	const drainPending = (): JobRecord[] => runtime.takePending();

	// Opt-in wake: a `wake` job finished while the agent is idle. Report *all*
	// pending completions, not just the waking one, so a non-wake job that
	// finished earlier is not silently marked seen and dropped.
	const handleFinish = (job: Job): void => {
		if (!job.wake || busy) return;
		const pending = drainPending();
		if (pending.length === 0) return;
		try {
			pi.sendMessage(
				{ customType: JOB_CONTEXT_TYPE, content: buildContext(pending), display: false },
				{ triggerTurn: true },
			);
		} catch {
			// Waking is best-effort; the note is still delivered next turn.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		busy = false;
		runtime.load(ctx);
		// `shutdown` clears this; a reload or session replacement reuses the
		// runtime, so re-arm it on every session start.
		runtime.onFinish = handleFinish;
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
		const pending = drainPending();
		if (pending.length === 0) return undefined;
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
		await runtime.shutdown();
		try {
			ctx.ui.setStatus(STATUS_KEYS.jobs, undefined);
			ctx.ui.setStatus(STATUS_KEYS.jobsFailure, undefined);
		} catch {
			// UI may already be gone.
		}
	});
}
