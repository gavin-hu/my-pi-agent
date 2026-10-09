/**
 * Building the `pi` subprocess command line.
 *
 * The invocation helper mirrors the bundled example: prefer reusing the current
 * interpreter + script so a subagent runs the same build that dispatched it,
 * then fall back to a generic `pi` binary on PATH.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig } from "./agents.ts";
import type { DispatchDefaults } from "./types.ts";

/** Tools a read-only delegation may use: structured readers and web readers only. */
export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "web_search", "web_fetch"] as const;

/** Appended to a read-only agent's system prompt; the `--tools` list is the real gate. */
export const READ_ONLY_NOTE =
	"Read-only mode: you cannot write, edit, or run shell commands. Investigate and report findings only.";

/**
 * Resolve how to launch a nested `pi` process.
 *
 * When Pi's own entry script is a real file, reuse it with `process.execPath`.
 * When the runtime is a bundled/generic node or bun, fall back to `pi` on PATH.
 */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

/**
 * Build the argument list for one subagent run.
 *
 * `systemPromptPath` is the temp file holding the agent's system prompt, or
 * `null` when the agent has no prompt to append.
 */
export function buildAgentArgs(
	agent: AgentConfig,
	task: string,
	defaults: DispatchDefaults,
	systemPromptPath: string | null,
	readOnly = false,
): string[] {
	const args = ["--mode", "json", "-p", "--no-session"];

	const model = agent.model ?? defaults.model;
	if (model) args.push("--model", model);
	if (agent.model === undefined && defaults.thinkingLevel) args.push("--thinking", defaults.thinkingLevel);
	if (readOnly) args.push("--tools", readOnlyTools(agent).join(","));
	else if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);

	args.push(`Task: ${task}`);
	return args;
}

/**
 * The tool allowlist for a read-only run: an agent's own tools narrowed to
 * {@link READ_ONLY_TOOLS}. An agent with no reader tools (or no declaration)
 * falls back to the full reader set, so read-only delegation still does recon.
 */
export function readOnlyTools(agent: AgentConfig): string[] {
	const allowed = new Set<string>(READ_ONLY_TOOLS);
	const requested = agent.tools && agent.tools.length > 0 ? agent.tools : [...READ_ONLY_TOOLS];
	const kept = requested.filter((tool) => allowed.has(tool));
	return kept.length > 0 ? kept : [...READ_ONLY_TOOLS];
}
