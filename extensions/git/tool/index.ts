/**
 * git — a read-only git tool for Pi.
 *
 * Exposes one `git` tool with a closed set of actions (`status`, `diff`, `log`,
 * `show`, `branch`). It builds argv itself and runs git through `pi.exec`, so it
 * needs no shell and cannot be steered into a mutating subcommand. The tool is
 * annotated `readOnlyHint: true`, which lets plan mode keep git visibility even
 * though raw shell is disabled while planning.
 *
 * It is a module of the `git` extension: the composition root `../index.ts`
 * calls {@link registerGitTool}. Argument building lives in `schema.ts`,
 * formatting in `format.ts`, and transcript rendering in `render.ts`.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../../lib/env.ts";
import { formatGitResult } from "./format.ts";
import { renderGitCall, renderGitResult } from "./render.ts";
import { GitParams, buildGitArgs, type GitArgs } from "./schema.ts";

export const TOOL_NAME = "git";

/** Local git calls are fast; cap them so a stuck invocation cannot hang a turn. */
const TIMEOUT_MS = 30_000;

export interface GitDetails {
	action: GitArgs["action"];
	argv: string[];
	exitCode: number;
}

export function registerGitTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Git",
		description:
			"Read-only git inspection with no shell. Use it to understand working-tree changes, recent history, one " +
			"commit or tag, or the branch list. It cannot commit, stage, push, or run arbitrary git commands. " +
			"Parameters by action: status(path); diff(ref, staged, stat, path); log(ref, limit, stat, path); " +
			"show(ref, stat, path); branch(no parameters).",
		promptSnippet: "Inspect git state read-only (status, diff, log, show, branch).",
		promptGuidelines: [
			"Use the git tool for status/diff/log/show/branch instead of a shell command.",
			"It is read-only: it cannot commit, stage, push, or change refs.",
			"Pass only the parameters that apply to the chosen action; other parameters are ignored.",
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

			// pi has no mutable session cwd, so the worktree module exports the
			// effective root as PI_WORKTREE_ROOT. Honor it so read-only git follows
			// the isolated worktree instead of the main checkout.
			const cwd = resolveEffectiveCwd(ctx.cwd);
			const result = await pi.exec("git", argv, { cwd, timeout: TIMEOUT_MS, signal });
			const { text, isError } = formatGitResult(argv, result);
			return {
				content: [{ type: "text", text }],
				details: { action: args.action, argv, exitCode: result.code } satisfies GitDetails,
				...(isError ? { isError: true } : {}),
			};
		},

		renderCall: (args, theme) => renderGitCall(args as GitArgs, theme),
		renderResult: (result, { expanded }, theme) =>
			renderGitResult(result as AgentToolResult<unknown>, { expanded }, theme),
	});
}
