/**
 * Model-facing registration for the `job` tool.
 *
 * One tool with seven actions: `start`, `list`, `status`, `logs`, `kill`,
 * `wait`, `clear`. A background process can outlive the tool call, so `start`
 * returns immediately with an id; the model polls with `status`/`logs` or
 * blocks with `wait`. Failures come back as an error result.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	compareJobs,
	formatCallText,
	formatCompletion,
	formatJobList,
	formatJobOutcomeLine,
	formatJobStatus,
} from "./format.ts";
import type { JobsRuntime } from "./runtime.ts";
import { JobParams, normalizeCall, type JobArgs, type JobCall } from "./schema.ts";
import { JobResult, type JobResultInput } from "./tui.ts";
import { toRecord, type JobDetails } from "./types.ts";

export const TOOL_NAME = "job";

/** Collapsed transcript rows before the result is truncated. */
const RESULT_ROWS = 8;

function errorResult(
	action: JobDetails["action"],
	message: string,
): {
	content: Array<{ type: "text"; text: string }>;
	details: JobDetails;
	isError: true;
} {
	return {
		content: [{ type: "text", text: `Error: ${message}` }],
		details: { action, error: message },
		isError: true,
	};
}

const GUIDELINES = [
	"Use `job start` for long-running or background commands (builds, test suites, dev servers, watchers) so the turn is not blocked; it returns a job id immediately.",
	"Pass `timeoutMs` to `job start` to auto-kill a job that runs too long (SIGTERM, escalating to SIGKILL).",
	"Poll with `job status`/`job logs`, or use `job wait` when you must have the result before continuing.",
	"`job kill` stops a job (SIGTERM, escalating to SIGKILL); `job clear` removes finished jobs. Jobs are killed when the session ends unless started with `detached: true`.",
];

export function registerTools(pi: ExtensionAPI, runtime: JobsRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Job",
		description:
			"Manage background shell-command jobs. Actions: `start` (command, optional cwd/label/wake/detached/timeoutMs; returns a " +
			"job id), `list`, `status` (id), `logs` (id, optional lines), `kill` (id, optional signal), `wait` (id, optional " +
			"timeoutMs; blocks until it finishes), and `clear` (id or all finished jobs). Jobs are killed when the session " +
			"ends unless started `detached`.",
		promptSnippet: "Run and manage background shell-command jobs (start, list, status, logs, kill, wait, clear).",
		promptGuidelines: GUIDELINES,
		parameters: JobParams,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			let call: JobCall;
			try {
				call = normalizeCall(params as JobArgs);
			} catch (error) {
				return errorResult((params as JobArgs)?.action ?? "list", (error as Error).message);
			}

			try {
				switch (call.action) {
					case "start": {
						const job = runtime.start(
							{
								command: call.command,
								cwd: call.cwd,
								label: call.label,
								wake: call.wake,
								detached: call.detached,
								timeoutMs: call.timeoutMs,
							},
							ctx,
						);
						return {
							content: [
								{
									type: "text" as const,
									text: `Started ${job.id} (pid ${job.pid ?? "?"}): ${job.command}\nPoll with \`job status ${job.id}\`, or \`job wait ${job.id}\`.`,
								},
							],
							details: { action: "start", job: toRecord(job) } satisfies JobDetails,
						};
					}

					case "list": {
						const jobs = runtime.list();
						return {
							content: [{ type: "text" as const, text: formatJobList(jobs) }],
							details: { action: "list", jobs } satisfies JobDetails,
						};
					}

					case "status": {
						const job = runtime.get(call.id);
						if (!job) return errorResult("status", `no job "${call.id}".`);
						return {
							content: [{ type: "text" as const, text: formatJobStatus(job) }],
							details: { action: "status", job: toRecord(job) } satisfies JobDetails,
						};
					}

					case "logs": {
						const result = runtime.logs(call.id, call.lines);
						if (!result) return errorResult("logs", `no job "${call.id}".`);
						return {
							content: [{ type: "text" as const, text: result.text }],
							details: {
								action: "logs",
								job: toRecord(result.job),
								logs: result.text,
								truncated: result.truncated,
							} satisfies JobDetails,
						};
					}

					case "kill": {
						const before = runtime.get(call.id);
						if (!before) return errorResult("kill", `no job "${call.id}".`);
						const job = runtime.kill(call.id, call.signal);
						if (!job) return errorResult("kill", `no job "${call.id}".`);
						const wasRunning = before.status === "running";
						return {
							content: [
								{
									type: "text" as const,
									text: wasRunning
										? `Sent ${call.signal ?? "SIGTERM"} to ${job.id} (${job.label}).`
										: `${job.id} already ${job.status}; nothing to kill.`,
								},
							],
							details: {
								action: "kill",
								job: toRecord(job),
								signalled: wasRunning,
							} satisfies JobDetails,
						};
					}

					case "wait": {
						const result = await runtime.wait(call.id, call.timeoutMs, signal, () =>
							onUpdate?.({
								content: [{ type: "text" as const, text: `Waiting on ${call.id}…` }],
								details: { action: "wait", job: runtime.get(call.id) } satisfies JobDetails,
							}),
						);
						if (!result) return errorResult("wait", `no job "${call.id}".`);
						const { job, timedOut, cancelled } = result;
						const note = cancelled
							? " (wait cancelled; the job is still running)"
							: timedOut
								? " (still running after the timeout)"
								: "";
						return {
							content: [
								{
									type: "text" as const,
									text: `${formatCompletion(job)}${note}${job.lastLine ? `\nlast: ${job.lastLine}` : ""}`,
								},
							],
							details: {
								action: "wait",
								job: toRecord(job),
								timedOut,
								cancelled,
							} satisfies JobDetails,
						};
					}

					case "clear": {
						const result = runtime.clear(call.id, call.all ?? false);
						if (result.refused) return errorResult("clear", result.refused);
						return {
							content: [
								{
									type: "text" as const,
									text:
										result.cleared === 0
											? "Nothing to clear."
											: `Cleared ${result.cleared} job${result.cleared === 1 ? "" : "s"}.`,
								},
							],
							details: { action: "clear", cleared: result.cleared, jobs: runtime.list() } satisfies JobDetails,
						};
					}
				}
			} catch (error) {
				return errorResult(call.action, (error as Error).message);
			}
		},

		renderCall(args, theme, context) {
			const action = typeof args.action === "string" ? args.action : "job";
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					theme.fg("muted", formatCallText(action, args as Record<string, unknown>, context.argsComplete)),
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
			const details = result.details as JobDetails | undefined;
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.error) {
				text.setText(theme.fg("error", `Error: ${details.error}`));
				return text;
			}

			if (options.isPartial) {
				const id = details.job?.id;
				text.setText(theme.fg("warning", id ? `Waiting on ${id}…` : "Waiting…"));
				return text;
			}

			if (details.action === "logs" && details.logs !== undefined) {
				const all = details.logs.split("\n");
				const shown = options.expanded ? all : all.slice(Math.max(0, all.length - RESULT_ROWS));
				const input: JobResultInput = { kind: "logs", lines: shown, earlier: all.length - shown.length };
				const view = context.lastComponent instanceof JobResult ? context.lastComponent : new JobResult(input, theme);
				view.setInput(input, theme);
				return view;
			}

			if (details.action === "list" && details.jobs) {
				if (details.jobs.length === 0) {
					text.setText(theme.fg("muted", "No jobs."));
					return text;
				}
				const ordered = [...details.jobs].sort(compareJobs);
				const shown = options.expanded ? ordered : ordered.slice(0, RESULT_ROWS);
				const input: JobResultInput = { kind: "list", jobs: shown, more: ordered.length - shown.length };
				const view = context.lastComponent instanceof JobResult ? context.lastComponent : new JobResult(input, theme);
				view.setInput(input, theme);
				return view;
			}

			if (details.action === "clear") {
				const count = details.cleared ?? 0;
				text.setText(
					theme.fg("muted", count === 0 ? "Nothing to clear." : `Cleared ${count} job${count === 1 ? "" : "s"}.`),
				);
				return text;
			}

			if (details.job) {
				let line = formatJobOutcomeLine(details.job, theme);
				if (details.action === "wait" && details.timedOut) {
					line += theme.fg("warning", " · still running after the timeout");
				} else if (details.action === "wait" && details.cancelled) {
					line += theme.fg("warning", " · wait cancelled; job still running");
				}
				text.setText(line);
				return text;
			}

			const first = result.content[0];
			text.setText(first?.type === "text" ? first.text : "");
			return text;
		},
	});
}
