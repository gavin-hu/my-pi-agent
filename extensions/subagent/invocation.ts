/**
 * Building the `pi` subprocess command line.
 *
 * `getPiInvocation` moved to `lib/pi-invocation.ts` so `doctor` can probe the
 * same rule; it is re-exported here so this module stays the subagent's single
 * import for invocation concerns.
 */

import { WORKSPACE_READERS } from "../../lib/policy.ts";
import { WEB_SEARCH_TOOL } from "../../lib/tool-names.ts";
import type { AgentConfig } from "./agents.ts";
import type { DispatchDefaults } from "./types.ts";

export { getPiInvocation, type PiInvocation } from "../../lib/pi-invocation.ts";

/**
 * Tools a read-only delegation may use: the structured readers, the document reader,
 * and search. `web_fetch` is deliberately absent — a fetch is an outbound channel, so a
 * prompt-injected child could carry a document it read out of the machine on a body or a
 * query string. The parent fetches the page and hands the child the text.
 */
export const READ_ONLY_TOOLS = [...WORKSPACE_READERS, WEB_SEARCH_TOOL] as const;

/** Appended to a read-only agent's system prompt; the `--tools` list is the real gate. */
export const READ_ONLY_NOTE =
	"Read-only mode: you cannot write, edit, run shell commands, or fetch a URL. Investigate and report " +
	"findings only; ask for a page to be fetched for you when you need one.";

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
