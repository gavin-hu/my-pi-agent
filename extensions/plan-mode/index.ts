/**
 * plan-mode — a read-only planning mode for Pi.
 *
 * While plan mode is on, the file-writing tools are removed from the active
 * set and bash is limited to read-only commands. The model investigates,
 * produces a plan, and calls `exit_plan_mode` to ask the user for approval.
 *
 * Toggle with `/plan`, `Ctrl+Alt+P`, or start with `--plan`. The state is
 * persisted as a custom session entry, so it follows the active branch.
 *
 * Load with:  pi --extension ./extensions/plan-mode
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { registerCommands } from "./commands.ts";
import { createPlanRuntime, RESTRICTED_TOOLS } from "./runtime.ts";
import { analyzeCommand } from "./safety.ts";
import { registerTools } from "./tools.ts";

/** Marker embedded in the injected prompt and used to filter stale context. */
export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";

/** Set form of `RESTRICTED_TOOLS`, built once instead of per tool call. */
const RESTRICTED_TOOL_NAMES = new Set<string>(RESTRICTED_TOOLS);

export const PLAN_MODE_CONTEXT = `${PLAN_MODE_MARKER}
You are in plan mode: a read-only exploration mode for safe code analysis.

- The write and edit tools are disabled, and bash is limited to read-only commands.
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
	const runtime = createPlanRuntime(pi);

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

	// Block file writes and non-read-only bash while planning.
	pi.on("tool_call", (event) => {
		if (!runtime.isEnabled()) return undefined;

		if (RESTRICTED_TOOL_NAMES.has(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode: ${event.toolName} is disabled. Call exit_plan_mode and get approval first.`,
			};
		}
		if (event.toolName !== "bash") return undefined;

		const command = typeof event.input.command === "string" ? event.input.command : "";
		const verdict = analyzeCommand(command);
		if (!verdict.safe) {
			return {
				block: true,
				reason: `Plan mode: command blocked (${verdict.reason}). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
		return undefined;
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
