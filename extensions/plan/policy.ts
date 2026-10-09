/**
 * Plan mode's read-only policy.
 *
 * Wires the shared {@link createReadOnlyPolicy} to plan mode's specifics: the
 * structured readers and trackers that stay available, the tools that are
 * always blocked, and the guidance shown when a tool is refused. It lives apart
 * from `index.ts` so tests and future read-only modes can build the policy
 * without loading the extension wiring.
 *
 * Plan mode keeps raw shell on a short leash: `bash` and `powershell` stay
 * active only so the model can run read-only git commands, and the `tool_call`
 * guard in `index.ts` refuses anything that is not one (see `git-bash.ts`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadOnlyPolicy, type ReadOnlyPolicy } from "../../lib/policy.ts";
import { SUBAGENT_TOOL } from "../../lib/tool-names.ts";
import { ENTER_TOOL } from "./runtime.ts";

/**
 * Tools that stay available while planning: structured readers, the trackers,
 * the git-only `bash`, and the known web/question readers. They are also the
 * tools the path backstop does not second-guess.
 */
export const PLAN_SAFE_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"todo",
	"goal",
	"bash",
	"ask_user_question",
	"web_search",
	"web_fetch",
];

/**
 * Tools that may stay active while planning. `subagent` is here so it is not
 * filtered out, but it is not in {@link PLAN_SAFE_TOOLS}: the `tool_call` guard
 * forces it read-only before the path backstop would see it. `powershell` is
 * deliberately absent — it is default-denied like any other shell.
 */
export const PLAN_ALLOWED_TOOLS = [...PLAN_SAFE_TOOLS, SUBAGENT_TOOL];
/** Tools always blocked while planning, even when annotated read-only. */
const ALWAYS_BLOCKED_TOOLS = ["write", "edit", ENTER_TOOL];

/** One-clause description of the read-only guarantee, reused across prompts. */
export const READ_ONLY_SUMMARY =
	"write and edit are disabled, bash is limited to read-only git commands, and other mutating tools are blocked; " +
	"subagent delegation is forced read-only, and the only write is write_plan, which saves the plan under .pi/plans";

/** Shown when a tool call is refused while planning. */
export const BLOCKED_GUIDANCE = "Call exit_plan_mode and get approval before using it.";

/** Appended to a refused `bash` call; names the readers and the exit hatch. */
export const BASH_BLOCKED_GUIDANCE =
	"Use the read, grep, find, and ls tools for files, or call exit_plan_mode and get approval before using other shell commands.";

/**
 * Build plan mode's read-only policy: known readers and the plan/goal trackers
 * are allowed, write/edit/shell/`enter_plan_mode` are always blocked, and every
 * other tool must carry the MCP `readOnlyHint` to pass.
 */
export function createPlanPolicy(pi: ExtensionAPI): ReadOnlyPolicy {
	return createReadOnlyPolicy({
		allow: PLAN_ALLOWED_TOOLS,
		deny: ALWAYS_BLOCKED_TOOLS,
		annotations: (name) => pi.getAllTools().find((tool) => tool.name === name)?.annotations,
		guidance: BLOCKED_GUIDANCE,
	});
}
