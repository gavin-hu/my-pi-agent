/**
 * git — a read-only git tool for Pi.
 *
 * Exposes one `git` tool with a closed set of actions (`status`, `diff`, `log`,
 * `show`, `branch`). It builds argv itself and runs git through `pi.exec`, so it
 * needs no shell and cannot be steered into a mutating subcommand. The tool is
 * annotated `readOnlyHint: true`, which lets plan mode keep git visibility even
 * though raw shell is disabled while planning.
 *
 * Load with:  pi --extension ./extensions/git
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { MAX_OUTPUT, formatGitResult } from "./format.ts";
import { GitParams, buildGitArgs, type GitArgs } from "./schema.ts";

export const TOOL_NAME = "git";

/** Lines of output shown in an unexpanded result. */
const PREVIEW_LINES = 12;
/** Local git calls are fast; cap them so a stuck invocation cannot hang a turn. */
const TIMEOUT_MS = 30_000;

export interface GitDetails {
	action: string;
	argv: string[];
	exitCode: number;
}

function preview(text: string, expanded: boolean): string {
	const lines = text.split("\n");
	if (expanded || lines.length <= PREVIEW_LINES) return text;
	return [...lines.slice(0, PREVIEW_LINES), `… ${lines.length - PREVIEW_LINES} more lines`].join("\n");
}

export default function git(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Git",
		description:
			"Read-only git inspection with no shell: status, diff, log, show, and branch listing. Use it to understand " +
			"working-tree changes, recent history, a commit, or the branch list. It cannot commit, stage, push, or run " +
			"arbitrary git commands.",
		promptSnippet: "Inspect git state read-only (status, diff, log, show, branch).",
		promptGuidelines: [
			"Use the git tool for status/diff/log/show/branch instead of a shell command.",
			"It is read-only: it cannot commit, stage, push, or change refs.",
		],
		parameters: GitParams,
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const args = params as GitArgs;
			let argv: string[];
			try {
				argv = buildGitArgs(args);
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: { action: args.action, argv: [], exitCode: 1 } satisfies GitDetails,
					isError: true,
				};
			}

			const result = await pi.exec("git", argv, { cwd: ctx.cwd, timeout: TIMEOUT_MS, signal });
			const { text, isError } = formatGitResult(argv, result);
			return {
				content: [{ type: "text", text }],
				details: { action: args.action, argv, exitCode: result.code } satisfies GitDetails,
				...(isError ? { isError: true } : {}),
			};
		},

		renderCall(args, theme) {
			const action = typeof (args as GitArgs)?.action === "string" ? (args as GitArgs).action : "";
			return new Text(theme.fg("toolTitle", theme.bold("git ")) + theme.fg("muted", action), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const content = result.content[0];
			const text = content?.type === "text" ? content.text : "";
			const capped = text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… output truncated` : text;
			return new Text(theme.fg("dim", preview(capped, expanded)), 0, 0);
		},
	});
}
