/**
 * Building the `pi` subprocess command line.
 *
 * `getPiInvocation` moved to `lib/pi-invocation.ts` so `doctor` can probe the
 * same rule; it is re-exported here so this module stays the subagent's single
 * import for invocation concerns.
 */

import { WORKSPACE_READERS } from "../../lib/policy.ts";
import { SUBAGENT_TOOL } from "../../lib/tool-names.ts";
import type { AgentConfig } from "./agents.ts";
import type { DispatchDefaults } from "./types.ts";

export { getPiInvocation, type PiInvocation } from "../../lib/pi-invocation.ts";

/**
 * Tools a read-only delegation may use: the shared workspace readers, and nothing else.
 *
 * No network tool is here at all. A fetch is an outbound channel and so is a search query —
 * the payload is text the model chose — so a child working from a document it read could
 * carry that document out either way. The caller searches and fetches, and hands the child
 * the text; `gates.test.ts` holds the allowlist to this list.
 */
export const READ_ONLY_TOOLS = [...WORKSPACE_READERS] as const;

/** Appended to a read-only agent's system prompt; the `--tools` list is the real gate. */
export const READ_ONLY_NOTE =
	"Read-only mode: you cannot write, edit, run shell commands, or reach the network. Investigate and report " +
	"findings only; ask the caller to search or fetch a page for you when you need one.";

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
	else if (agent.tools && agent.tools.length > 0) {
		// A child cannot delegate, so its list never names the `subagent` tool even when the agent's
		// frontmatter asks for it. A list that names nothing else is left as written rather than
		// filtered to nothing: an absent `--tools` hands the child the host's whole default set,
		// which is a grant where the agent asked for one tool — the dispatcher's refusal is what
		// stops that agent, not this filter.
		const granted = agent.tools.filter((tool) => tool !== SUBAGENT_TOOL);
		args.push("--tools", (granted.length > 0 ? granted : agent.tools).join(","));
	}
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
