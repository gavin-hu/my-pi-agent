/**
 * The `run_check` tool.
 *
 * It returns a normal result for a failing check (the command ran and the model
 * should fix it), and an error result only when the check could not run at all.
 * The structured content is the machine-readable mirror of the text; the tail is
 * extra detail for the transcript and is deliberately not in that contract.
 */

import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { formatCheckReport } from "./format.ts";
import type { CheckRuntime } from "./runtime.ts";
import type { RunCheckDetails } from "./types.ts";

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

		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionToolContext) {
			const target = (params as RunCheckArgs).target ?? "all";
			const result = await runtime.run(target, ctx);
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
				content: [{ type: "text", text: formatCheckReport(result) }],
				details,
				structuredContent: structured,
				isError: result.status === "error",
			};
		},
	});
}
