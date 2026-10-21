/**
 * The `run_check` tool.
 *
 * It returns a normal result for a failing check (the command ran and the model
 * should fix it), and an error result only when the check could not run at all.
 * The structured content is the machine-readable mirror of the text; the tail is
 * extra detail for the transcript and is deliberately not in that contract.
 *
 * A run can take minutes and can print nothing for long stretches, so `execute`
 * publishes one partial result as soon as the runtime starts. The renderer turns
 * that into a running line and repaints its elapsed time once a second instead
 * of waiting for the first chunk.
 */

import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { sanitizeLine } from "../../lib/format.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, elapsedSuffix, errorLine, rejectionLine, syncElapsedTimer } from "../../lib/tui/tool.ts";
import { paint } from "../../lib/tui/tokens.ts";
import { formatCheckReport } from "./format.ts";
import { CheckResultBlock } from "./render.ts";
import { checkErrorResult, type CheckRuntime } from "./runtime.ts";
import type { ActiveCheck, CheckResult, RunCheckDetails } from "./types.ts";

/** The tool's registered name, shared with the naming guard. */
export const TOOL_NAME = "run_check";

const TargetSchema = Type.Union(
	[Type.Literal("test"), Type.Literal("lint"), Type.Literal("typecheck"), Type.Literal("all")],
	{ description: "Which detected command to run; defaults to all." },
);

const FailureSchema = Type.Object({
	path: Type.Optional(Type.String()),
	line: Type.Optional(Type.Integer()),
	column: Type.Optional(Type.Integer()),
	test: Type.Optional(Type.String()),
	message: Type.String(),
	command: Type.String(),
});

export const RunCheckParams = Type.Object({
	target: Type.Optional(TargetSchema),
});

export type RunCheckArgs = Static<typeof RunCheckParams>;

export const RunCheckOutput = Type.Object({
	target: TargetSchema,
	status: Type.Union([
		Type.Literal("passed"),
		Type.Literal("failed"),
		Type.Literal("timeout"),
		Type.Literal("cancelled"),
		Type.Literal("error"),
	]),
	commands: Type.Array(Type.String()),
	exitCode: Type.Union([Type.Integer(), Type.Null()]),
	durationMs: Type.Integer(),
	truncated: Type.Boolean(),
	failures: Type.Array(FailureSchema),
});

export type RunCheckStructured = Static<typeof RunCheckOutput>;

/** One settled run as Pi stores it: model text, transcript details, structured mirror. */
function resultPayload(result: CheckResult) {
	const details: RunCheckDetails = { ...result };
	const structured: RunCheckStructured = {
		target: result.target,
		status: result.status,
		commands: result.commands,
		exitCode: result.exitCode,
		durationMs: result.durationMs,
		truncated: result.truncated,
		failures: result.failures,
	};
	return {
		content: [{ type: "text" as const, text: formatCheckReport(result) }],
		details,
		structuredContent: structured,
		isError: result.status === "error",
	};
}

/** The partial result's details: no failures yet, and the commands now running. */
function runningDetails(active: ActiveCheck): RunCheckDetails {
	return {
		target: active.target,
		status: "running",
		commands: [...active.commands],
		exitCode: null,
		durationMs: active.elapsedMs(),
		truncated: false,
		failures: [],
	};
}

export function registerCheckTool(pi: ExtensionAPI, runtime: CheckRuntime): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Run checks",
		description:
			"Run the project's detected test, lint, or typecheck command (or check.command) in a supervised " +
			"process and return structured failures. The command is a shell command from the project config or " +
			"manifest, with a timeout and a bounded log; it can write to the project just like a shell command.",
		promptSnippet: "Run the project's checks and return structured failures.",
		promptGuidelines: [
			"Use run_check before claiming a change is complete.",
			"Prefer run_check over an ad-hoc test command so failures come back with file and line locations.",
			"Do not start a check while another check is running.",
		],
		parameters: RunCheckParams,
		outputSchema: RunCheckOutput,
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },

		async execute(_toolCallId, params, _signal, onUpdate, ctx: ExtensionToolContext) {
			const target = params.target ?? "all";
			let active: ActiveCheck;
			try {
				active = runtime.start(target, ctx);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return resultPayload(checkErrorResult(target, message));
			}
			onUpdate?.({ content: [], details: runningDetails(active) });
			return resultPayload(await active.promise);
		},

		renderCall(args, theme, context) {
			const subject = context.argsComplete ? (args.target ?? "all") : "…";
			return callLine(theme, context.lastComponent, TOOL_NAME, subject, "middle");
		},

		renderResult(result, options, theme, context) {
			const details = toolDetails<RunCheckDetails>(result.details);
			const startedAt = syncElapsedTimer(options.isPartial, context);
			if (!details) {
				const text = reuseText(context.lastComponent);
				text.setText(rejectionLine(theme, result, options.expanded));
				return text;
			}
			if (details.status === "running") {
				const text = reuseText(context.lastComponent);
				const commands = details.commands.length > 0 ? sanitizeLine(details.commands.join(", ")) : "checks";
				const elapsed = startedAt === undefined ? "" : elapsedSuffix(theme, Date.now() - startedAt);
				text.setText(paint(theme, "info", `Running ${commands}…`) + elapsed);
				return text;
			}
			if (details.status === "error") {
				const text = reuseText(context.lastComponent);
				text.setText(errorLine(theme, details.error ?? "the check could not run"));
				return text;
			}
			const input = { details, expanded: options.expanded };
			const view =
				context.lastComponent instanceof CheckResultBlock ? context.lastComponent : new CheckResultBlock(input, theme);
			view.setInput(input, theme);
			return view;
		},
	});
}
