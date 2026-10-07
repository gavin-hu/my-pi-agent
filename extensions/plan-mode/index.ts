/**
 * plan-mode — a read-only planning mode for Pi.
 *
 * While plan mode is on, tools that are not read-only are removed from the
 * active set or blocked: write and edit are hidden, raw shell (bash and
 * powershell) is disabled, and everything else that mutates (subagent,
 * worktree, MCP tools) is blocked. The model investigates, produces a plan,
 * and calls `exit_plan_mode` to ask the user for approval.
 *
 * Toggle with `/plan`, `Ctrl+Alt+P`, or start with `--plan`. The state is
 * persisted as a custom session entry, so it follows the active branch.
 *
 * Load with:  pi --extension ./extensions/plan-mode
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { hasPathInput } from "../_shared/path-guard.ts";
import { registerCommands } from "./commands.ts";
import { createPlanPolicy, BLOCKED_GUIDANCE, PLAN_SAFE_TOOLS, READ_ONLY_SUMMARY } from "./policy.ts";
import { createPlanRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** Marker embedded in the injected prompt and used to filter stale context. */
export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";

const PLAN_MODE_CONTEXT = `${PLAN_MODE_MARKER}
You are in plan mode: a read-only exploration mode for safe code analysis.

- While planning, ${READ_ONLY_SUMMARY}.
- Investigate the code and design a concrete plan; do not modify anything yet.
- Write the full plan in your reply, then call exit_plan_mode so the user can read it and approve, keep planning, or ask for a refinement.
- If you need to choose between approaches, use ask_user_question before finalizing the plan.

If the todo tool is active, you may use it to record the planned steps, but do not start executing until the plan is approved.`;

function isPlanModeContext(message: AgentMessage): boolean {
	const candidate = message as AgentMessage & { customType?: string };
	if (candidate.customType === "plan-mode-context") return true;
	if (candidate.role !== "user") return false;

	const content = candidate.content;
	if (typeof content === "string") return content.includes(PLAN_MODE_MARKER);
	if (Array.isArray(content)) {
		return content.some((block) => block.type === "text" && (block as { text?: string }).text?.includes(PLAN_MODE_MARKER));
	}
	return false;
}

export default function planMode(pi: ExtensionAPI): void {
	const policy = createPlanPolicy(pi);
	const runtime = createPlanRuntime(pi, policy);

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: (ctx) => runtime.toggle(ctx),
	});

	pi.on("session_start", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_tree", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("plan-mode", undefined));

	/**
	 * Why a tool call is blocked while planning, or undefined when it may
	 * proceed. Two layers: the policy (readers, `readOnlyHint`, deny list), then
	 * the path backstop (a hint on a path-carrying tool is only a claim).
	 */
	const blockedReason = (toolName: string, input: unknown): string | undefined => {
		const blocked = policy.check(toolName);
		if (blocked) return `Plan mode: ${blocked.reason}`;
		if (hasPathInput(input) && !PLAN_SAFE_TOOLS.includes(toolName)) {
			return `Plan mode: "${toolName}" takes a file path and is not a known reader. ${BLOCKED_GUIDANCE}`;
		}
		return undefined;
	};

	// Block anything that is not read-only while planning. The active-set gating
	// above hides most of these; this is the second layer for tools already
	// declared in an in-flight request, and the guard for tools we did not know
	// about when the extension loaded (MCP servers, future extensions).
	pi.on("tool_call", (event) => {
		if (!runtime.isEnabled()) return undefined;
		const reason = blockedReason(event.toolName, event.input);
		return reason ? { block: true, reason } : undefined;
	});

	// Tell the model it is planning.
	pi.on("before_agent_start", () => {
		if (!runtime.isEnabled()) return undefined;
		return { message: { customType: "plan-mode-context", content: PLAN_MODE_CONTEXT, display: false } };
	});

	// Keep stale plan-mode context out of later, non-plan turns (for example after /resume).
	pi.on("context", (event) => {
		const planContexts = event.messages.filter(isPlanModeContext);
		if (runtime.isEnabled()) {
			// `before_agent_start` injects one each turn; keep only the newest so
			// repeated instructions do not accumulate during a long plan.
			if (planContexts.length <= 1) return undefined;
			const last = planContexts[planContexts.length - 1];
			return { messages: event.messages.filter((message) => !isPlanModeContext(message) || message === last) };
		}
		return { messages: event.messages.filter((message) => !isPlanModeContext(message)) };
	});
}
