/**
 * Model-facing registration for the `job` tool.
 *
 * One tool with eight actions: `start`, `list`, `status`, `logs`, `send`,
 * `kill`, `wait`, `clear`. A background process can outlive the tool call, so
 * `start` returns immediately with an id; the model polls with `status`/`logs` or
 * blocks with `wait`. `stdin: true` opens a pipe that `send` writes to. Failures
 * come back as an error result.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { errorResult, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import {
	callLine,
	detailsOrLine,
	elapsedSuffix,
	isTailResult,
	rejectionLine,
	syncElapsedTimer,
	TailResult,
} from "../../lib/tui/tool.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import {
	compareJobs,
	formatCallText,
	formatCompletion,
	formatJobList,
	formatJobOutcomeLine,
	formatJobStatus,
	shortLabel,
} from "./format.ts";
import type { JobsRuntime } from "./runtime.ts";
import { JobParams, normalizeCall, type JobArgs, type JobCall } from "./schema.ts";
import { toRecord } from "./store.ts";
import { jobTail, type JobResultInput } from "./render.ts";
import type { JobDetails, JobRecord } from "./types.ts";

export const TOOL_NAME = "job";

/** Collapsed transcript rows before the result is truncated. */
const RESULT_ROWS = 8;

const GUIDELINES = [
	"Use `job start` for long-running or background commands (builds, test suites, servers, watchers) so the turn is not blocked.",
	"Poll with `job status`/`job logs`, or use `job wait` when you must have the result before continuing.",
	"Start a job with `stdin: true` to drive an interactive program: `job send` writes a line to it and `eof: true` closes its input.",
	"Use `job kill` to stop a running job and `job clear` to drop finished ones.",
];

export function registerTools(pi: ExtensionAPI, runtime: JobsRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Job",
		description:
			"Manage background shell-command jobs. Actions: `start` (returns a job id immediately; `stdin: true` opens a stdin pipe), " +
			"`list`, `status`/`logs`/`send`/`kill`/`wait` (by id), and `clear`. Jobs are killed when the session ends unless started `detached`.",
		promptSnippet: "Run and manage background shell-command jobs (start, list, status, logs, send, kill, wait, clear).",
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
						const job = await runtime.start(
							{
								command: call.command,
								cwd: call.cwd,
								label: call.label,
								wake: call.wake,
								detached: call.detached,
								stdin: call.stdin,
								timeoutMs: call.timeoutMs,
							},
							ctx,
						);
						return textResult(
							`Started ${job.id} (pid ${job.pid ?? "?"}): ${job.command}\nPoll with \`job status ${job.id}\`, or \`job wait ${job.id}\`.`,
							{ action: "start", job: toRecord(job) } satisfies JobDetails,
						);
					}

					case "list": {
						const jobs = runtime.list();
						return textResult(formatJobList(jobs, Date.now(), runtime.sessionId), {
							action: "list",
							jobs,
							sessionId: runtime.sessionId,
						} satisfies JobDetails);
					}

					case "status": {
						const job = runtime.get(call.id);
						if (!job) return errorResult("status", `no job "${call.id}".`);
						return textResult(formatJobStatus(job, Date.now(), runtime.sessionId), {
							action: "status",
							job: toRecord(job),
							sessionId: runtime.sessionId,
						} satisfies JobDetails);
					}

					case "logs": {
						const result = runtime.logs(call.id, call.lines);
						if (!result) return errorResult("logs", `no job "${call.id}".`);
						return textResult(result.text, {
							action: "logs",
							job: toRecord(result.job),
							logs: result.lines.join("\n"),
							truncated: result.truncated,
						} satisfies JobDetails);
					}

					case "send": {
						const result = runtime.send(call.id, {
							input: call.input,
							newline: call.newline,
							eof: call.eof,
						});
						const job = result.job;
						const text =
							result.sent > 0
								? `Sent ${result.sent} character${result.sent === 1 ? "" : "s"} to ${job.id} (${shortLabel(job)})${
										result.closed ? " and closed its stdin" : ""
									}.`
								: `Closed ${job.id}'s stdin.`;
						return textResult(text, {
							action: "send",
							job: toRecord(job),
							sent: result.sent,
							stdinClosed: result.closed,
						} satisfies JobDetails);
					}

					case "kill": {
						const before = runtime.get(call.id);
						if (!before) return errorResult("kill", `no job "${call.id}".`);
						const job = await runtime.kill(call.id, call.signal);
						if (!job) return errorResult("kill", `no job "${call.id}".`);
						const wasRunning = before.status === "running";
						return textResult(
							wasRunning
								? `Sent ${call.signal ?? "SIGTERM"} to ${job.id} (${job.label}).`
								: `${job.id} already ${job.status}; nothing to kill.`,
							{
								action: "kill",
								job: toRecord(job),
								signalled: wasRunning,
								signal: call.signal ?? "SIGTERM",
							} satisfies JobDetails,
						);
					}

					case "wait": {
						const result = await runtime.wait(call.id, call.timeoutMs, signal, () =>
							onUpdate?.(
								textResult(`Waiting on ${call.id}…`, {
									action: "wait",
									job: runtime.get(call.id),
								} satisfies JobDetails),
							),
						);
						if (!result) return errorResult("wait", `no job "${call.id}".`);
						const { job, timedOut, cancelled } = result;
						const note = cancelled
							? " (wait cancelled; the job is still running)"
							: timedOut
								? " (still running after the timeout)"
								: "";
						return textResult(`${formatCompletion(job)}${note}${job.lastLine ? `\nlast: ${job.lastLine}` : ""}`, {
							action: "wait",
							job: toRecord(job),
							timedOut,
							cancelled,
						} satisfies JobDetails);
					}

					case "clear": {
						const result = runtime.clear(call.id, call.all ?? false);
						if (result.refused) return errorResult("clear", result.refused);
						return textResult(
							result.cleared === 0
								? "Nothing to clear."
								: `Cleared ${result.cleared} job${result.cleared === 1 ? "" : "s"}.`,
							{ action: "clear", cleared: result.cleared, jobs: runtime.list() } satisfies JobDetails,
						);
					}
				}
			} catch (error) {
				return errorResult(call.action, (error as Error).message);
			}
		},

		renderCall(args, theme, context) {
			const action = typeof args.action === "string" ? args.action : "job";
			const subject = formatCallText(action, args as Record<string, unknown>, context.argsComplete);
			return callLine(theme, context.lastComponent, TOOL_NAME, subject, "middle");
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const startedAt = syncElapsedTimer(options.isPartial, context);
			const outcome = detailsOrLine(theme, result, options.expanded, toolDetails<JobDetails>(result.details));
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const details = outcome.details;

			if (options.isPartial) {
				const id = details.job?.id;
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "warn", id ? `Waiting on ${id}…` : "Waiting…") + elapsed);
				return text;
			}

			if (details.action === "logs" && details.logs !== undefined) {
				const all = details.logs === "" ? [] : details.logs.split("\n");
				if (all.length === 0) {
					text.setText(paint(theme, "meta", "No output yet."));
					return text;
				}
				const shown = options.expanded ? all : all.slice(Math.max(0, all.length - RESULT_ROWS));
				const input: JobResultInput = { kind: "logs", lines: shown, earlier: all.length - shown.length };
				const previous = context.lastComponent;
				const tail = jobTail(input);
				const view = isTailResult<JobRecord>(previous) ? previous : new TailResult<JobRecord>(tail, theme);
				view.setInput(tail, theme);
				return view;
			}

			if (details.action === "list" && details.jobs) {
				if (details.jobs.length === 0) {
					text.setText(paint(theme, "meta", "No jobs."));
					return text;
				}
				const ordered = [...details.jobs].sort(compareJobs);
				const shown = options.expanded ? ordered : ordered.slice(0, RESULT_ROWS);
				const input: JobResultInput = {
					kind: "list",
					jobs: shown,
					more: ordered.length - shown.length,
					sessionId: details.sessionId,
				};
				const previous = context.lastComponent;
				const tail = jobTail(input);
				const view = isTailResult<JobRecord>(previous) ? previous : new TailResult<JobRecord>(tail, theme);
				view.setInput(tail, theme);
				return view;
			}

			if (details.action === "clear") {
				const count = details.cleared ?? 0;
				text.setText(
					paint(theme, "meta", count === 0 ? "Nothing to clear." : `Cleared ${count} job${count === 1 ? "" : "s"}.`),
				);
				return text;
			}

			if (details.job) {
				let line = formatJobOutcomeLine(details.job, theme);
				if (details.action === "wait" && details.timedOut) {
					line += paint(theme, "warn", " · still running after the timeout");
				} else if (details.action === "wait" && details.cancelled) {
					line += paint(theme, "warn", " · wait cancelled; job still running");
				} else if (details.action === "kill" && details.signalled) {
					line += paint(theme, "warn", ` · ${details.signal ?? "SIGTERM"} sent`);
				} else if (details.action === "send") {
					const badges: string[] = [];
					if (details.sent) badges.push(`sent ${details.sent}`);
					if (details.stdinClosed) badges.push("stdin closed");
					if (badges.length > 0) line += paint(theme, "faint", `${SEPARATORS.item}${badges.join(SEPARATORS.item)}`);
				} else if (details.action === "start") {
					const badges: string[] = [];
					if (details.job.detached) badges.push("detached");
					if (details.job.wake) badges.push("wake");
					if (badges.length > 0) line += paint(theme, "faint", `${SEPARATORS.item}${badges.join(SEPARATORS.item)}`);
				}
				text.setText(line);
				return text;
			}

			text.setText(rejectionLine(theme, result, options.expanded));
			return text;
		},
	});
}
