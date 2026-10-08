/**
 * Plan mode's read-only policy.
 *
 * Wires the shared {@link createReadOnlyPolicy} to plan mode's specifics: the
 * structured readers and trackers that stay available, the tools that are
 * always blocked, and the guidance shown when a tool is refused. It lives apart
 * from `index.ts` so tests and future read-only modes can build the policy
 * without loading the extension wiring.
 *
 * Plan mode does not run a shell: `bash` and `powershell` are denied outright,
 * so exploration goes through the structured `read`/`grep`/`find`/`ls` tools.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadOnlyPolicy, type ReadOnlyPolicy } from "../../lib/policy.ts";
import { ENTER_TOOL } from "./runtime.ts";

/** Tools that stay available while planning: readers, trackers, and the read-only git view. */
export const PLAN_SAFE_TOOLS = ["read", "grep", "find", "ls", "todo", "goal", "git"];
/** Tools always blocked while planning, even when annotated read-only. */
const ALWAYS_BLOCKED_TOOLS = ["write", "edit", "bash", "powershell", ENTER_TOOL];

/** One-clause description of the read-only guarantee, reused across prompts. */
export const READ_ONLY_SUMMARY =
	"write, edit, and raw shell (bash/powershell) are disabled and other mutating tools are blocked; the only write is " +
	"write_plan, which saves the plan under .pi/plans";

/** Shown when a tool call is refused while planning. */
export const BLOCKED_GUIDANCE = "Call exit_plan_mode and get approval before using it.";

/**
 * Build plan mode's read-only policy: known readers and the plan/goal trackers
 * are allowed, write/edit/shell/`enter_plan_mode` are always blocked, and every
 * other tool must carry the MCP `readOnlyHint` to pass.
 */
export function createPlanPolicy(pi: ExtensionAPI): ReadOnlyPolicy {
	return createReadOnlyPolicy({
		allow: PLAN_SAFE_TOOLS,
		deny: ALWAYS_BLOCKED_TOOLS,
		annotations: (name) => pi.getAllTools().find((tool) => tool.name === name)?.annotations,
		guidance: BLOCKED_GUIDANCE,
	});
}
