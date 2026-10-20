/**
 * Pure text for the check extension: the one-line summary, failure rows, the
 * detail body, and the model-facing report. No terminal access and no git.
 */

import { formatDuration, sanitizeLine, stripControlChars } from "../../lib/format.ts";
import { SEPARATORS } from "../../lib/tui/glyphs.ts";
import type { CheckResult, CheckStatus, Failure } from "./types.ts";
import type { SourceResult } from "./source.ts";

/** Failures shown in a model-facing report and in an expanded transcript result. */
export const MODEL_FAILURES = 20;

/**
 * What the summary helpers read: a final result, or the run details a partial
 * transcript result carries with `status: "running"`.
 */
export interface CheckSummary {
	status: CheckStatus | "running";
	commands: readonly string[];
	durationMs: number;
	failures: readonly Failure[];
	error?: string;
}

/** Command labels are script names and config text, so they are untrusted too. */
function formatCommands(commands: readonly string[]): string {
	return commands.length > 0 ? commands.map((command) => sanitizeLine(command)).join(", ") : "no command";
}

/** Whether a failure named a file, a test, or both. */
export function hasFailureLocation(failure: Failure): boolean {
	return failure.path !== undefined || failure.test !== undefined;
}

/** `path:line:col`, a test name, or a neutral label. */
export function formatFailureLocation(failure: Failure): string {
	if (failure.path) {
		const line = failure.line === undefined ? "" : `:${failure.line}`;
		const column = failure.column === undefined ? "" : `:${failure.column}`;
		return sanitizeLine(`${failure.path}${line}${column}`);
	}
	return sanitizeLine(failure.test ?? "check");
}

/** `path:line:col — message`, one line. */
export function formatFailureLine(failure: Failure): string {
	return `${formatFailureLocation(failure)}${SEPARATORS.item}${sanitizeLine(failure.message)}`;
}

/** The one-line result a passing run posts, and the headline of a failed one. */
export function formatCheckSummary(result: CheckResult): string {
	const commands = formatCommands(result.commands);
	const duration = formatDuration(result.durationMs);
	if (result.status === "passed") return `Check passed: ${commands}${SEPARATORS.item}${duration}`;
	if (result.status === "failed") {
		const count = result.failures.length;
		return `Check failed: ${count} failure${count === 1 ? "" : "s"}${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
	}
	if (result.status === "timeout") return `Check timed out: ${commands}${SEPARATORS.item}${duration}`;
	if (result.status === "cancelled") return `Check cancelled: ${commands}`;
	return `Check failed to run: ${sanitizeLine(result.error ?? "unknown error")}`;
}

/** The compact summary under the Check title and on a transcript result. */
export function formatResultSummary(result: CheckSummary): string {
	const commands = formatCommands(result.commands);
	const duration = formatDuration(result.durationMs);
	if (result.status === "running") return `running${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
	if (result.status === "passed") return `passed${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
	if (result.status === "failed") {
		const count = result.failures.length;
		// A fallback entry is the exit status, not a counted failure; the summary
		// says "failed" and the tail carries the reason.
		if (count > 0 && result.failures.every((failure) => !hasFailureLocation(failure))) {
			return `failed${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
		}
		return `${count} failure${count === 1 ? "" : "s"}${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
	}
	if (result.status === "timeout") return `timed out${SEPARATORS.item}${commands}${SEPARATORS.item}${duration}`;
	if (result.status === "cancelled") return `cancelled${SEPARATORS.item}${commands}`;
	return `error${SEPARATORS.item}${sanitizeLine(result.error ?? "unknown error")}`;
}

/** The source excerpt rows with a target marker and aligned line numbers. */
export function formatSourceExcerpt(excerpt: {
	startLine: number;
	endLine: number;
	targetLine: number;
	lines: readonly string[];
}): string[] {
	const width = String(excerpt.endLine).length;
	return excerpt.lines.map((text, index) => {
		const number = excerpt.startLine + index;
		const marker = number === excerpt.targetLine ? ">" : " ";
		const clean = stripControlChars(text).replaceAll("\t", "    ").slice(0, 2_000).trimEnd();
		return `${marker} ${String(number).padStart(width)} │ ${clean}`;
	});
}

/** The lines a failure detail pane shows: location, reason, source or tail. */
export function formatFailureDetail(failure: Failure, tail: string, source?: SourceResult): string[] {
	const lines = [
		`${formatFailureLocation(failure)}${SEPARATORS.item}${sanitizeLine(failure.command)}`,
		"",
		...sanitizeLine(failure.message).split("\n"),
	];
	if (source?.ok) {
		lines.push("", "Source:", ...formatSourceExcerpt(source.excerpt));
		return lines;
	}
	if (source && failure.path) lines.push("", `(source unavailable: ${sanitizeLine(source.reason)})`);
	const tailLines = tail
		.split("\n")
		.map((line) => sanitizeLine(line))
		.filter((line, index, all) => line !== "" || index === all.length - 1);
	if (tailLines.length > 0) lines.push("", "…", ...tailLines);
	return lines;
}

/** The model-facing report: summary, up to 20 failures, then the fallback tail. */
export function formatCheckReport(result: CheckResult): string {
	const lines = [formatCheckSummary(result)];
	for (const failure of result.failures.slice(0, MODEL_FAILURES)) {
		lines.push(`- ${formatFailureLine(failure)}${SEPARATORS.item}${sanitizeLine(failure.command)}`);
	}
	if (result.failures.length > MODEL_FAILURES) {
		lines.push(`… ${result.failures.length - MODEL_FAILURES} more failures in details`);
	}
	const fallbackOnly = result.failures.length > 0 && result.failures.every((failure) => !hasFailureLocation(failure));
	if ((result.failures.length === 0 || fallbackOnly) && result.status !== "passed" && result.tail.trim() !== "") {
		lines.push("", "Tail:", result.tail);
	}
	return lines.join("\n");
}
