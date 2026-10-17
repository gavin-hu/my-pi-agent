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
import { sanitizeLine } from "../../lib/format.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
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
import { JobResult, type JobResultInput } from "./tui.ts";
import type { JobDetails } from "./types.ts";

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
						const job = runtime.start(
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
							content: [{ type: "text" as const, text: formatJobList(jobs, Date.now(), runtime.sessionId) }],
							details: { action: "list", jobs, sessionId: runtime.sessionId } satisfies JobDetails,
						};
					}

					case "status": {
						const job = runtime.get(call.id);
						if (!job) return errorResult("status", `no job "${call.id}".`);
						return {
							content: [{ type: "text" as const, text: formatJobStatus(job, Date.now(), runtime.sessionId) }],
							details: { action: "status", job: toRecord(job), sessionId: runtime.sessionId } satisfies JobDetails,
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
								logs: result.lines.join("\n"),
								truncated: result.truncated,
							} satisfies JobDetails,
						};
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
						return {
							content: [{ type: "text" as const, text }],
							details: {
								action: "send",
								job: toRecord(job),
								sent: result.sent,
								stdinClosed: result.closed,
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
								signal: call.signal ?? "SIGTERM",
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
			const text = reuseText(context.lastComponent);
			text.setText(
				theme.fg("toolTitle", theme.bold(`${TOOL_NAME} `)) +
					paint(
						theme,
						"meta",
						sanitizeLine(formatCallText(action, args as Record<string, unknown>, context.argsComplete)),
					),
			);
			return text;
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context.lastComponent);
			const details = toolDetails<JobDetails>(result.details);
			if (!details) {
				const first = result.content[0];
				text.setText(first?.type === "text" ? first.text : "");
				return text;
			}
			if (details.error) {
				text.setText(paint(theme, "bad", `Error: ${sanitizeLine(details.error)}`));
				return text;
			}

			if (options.isPartial) {
				const id = details.job?.id;
				text.setText(paint(theme, "warn", id ? `Waiting on ${id}…` : "Waiting…"));
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
				const view = context.lastComponent instanceof JobResult ? context.lastComponent : new JobResult(input, theme);
				view.setInput(input, theme);
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
				const view = context.lastComponent instanceof JobResult ? context.lastComponent : new JobResult(input, theme);
				view.setInput(input, theme);
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

			const first = result.content[0];
			text.setText(first?.type === "text" ? first.text : "");
			return text;
		},
	});
}
