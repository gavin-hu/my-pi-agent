/**
 * plan — a file-backed planning mode for Pi.
 *
 * While plan mode is on, tools that are not read-only are removed from the
 * active set or blocked: write and edit are hidden, bash is limited to a single
 * read-only git command, powershell is blocked, and everything else that mutates
 * (worktree, MCP tools) is blocked. `subagent` stays active but is forced
 * read-only. The one permitted write is `write_plan`,
 * which saves the plan under `.pi/plans`. The model investigates, saves the
 * plan, and calls `exit_plan_mode` to read the file back and ask for approval.
 *
 * Toggle with `/plan`, `Ctrl+Alt+P`, or start with `--plan`. The state is
 * persisted as a custom session entry, so it follows the active branch.
 *
 * Load with:  pi --extension ./extensions/plan
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { fileURLToPath } from "node:url";
import { hasPathInput } from "./path-guard.ts";
import { isExtensionEnabled } from "../../lib/env.ts";
import { SUBAGENT_READ_ONLY_PARAM, SUBAGENT_TOOL } from "../../lib/tool-names.ts";
import { STATUS_KEYS } from "../../lib/ui.ts";
import { planModeNotice, registerCommands } from "./commands.ts";
import { checkReadOnlyGit } from "./git-bash.ts";
import {
	createPlanPolicy,
	BASH_BLOCKED_GUIDANCE,
	BLOCKED_GUIDANCE,
	PLAN_SAFE_TOOLS,
	READ_ONLY_SUMMARY,
} from "./policy.ts";
import { createPlanRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** Marker embedded in the injected prompt and used to filter stale context. */
export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";

const PLAN_MODE_CONTEXT = `${PLAN_MODE_MARKER}
You are in plan mode: a read-only exploration mode for safe code analysis.

- While planning, ${READ_ONLY_SUMMARY}.
- Raw shell is limited to read-only git commands through bash (for example git status, git diff, git log). Several may be chained with && or a semicolon; pipes, substitution, and redirection are blocked, and powershell is not available while planning. On native Windows bash runs through Git Bash, so these commands work there too.
- Shell is for git only. The working directory is already the project root (do not prefix commands with cd); use the read, grep, find, and ls tools to inspect files, and exit plan mode for any other shell command.
- Investigate the code and design a concrete plan; do not modify anything except the plan file.
- Save the full plan with write_plan (a short title and the complete markdown), then call exit_plan_mode with the returned plan_path so the user can read the file and approve, keep planning, or ask for a refinement.
- The plan file is the source of truth: after approval, follow its steps.
- Delegate broad exploration with subagent (for example the explorer agent). While planning it is forced to a read-only tool set, so it cannot write, edit, or run shell commands.
- If you need to choose between approaches, use ask_user_question before finalizing the plan.

If the todo tool is active, you may use it to record the planned steps, but do not start executing until the plan is approved.`;

/** This extension entry file, as Pi records it for our tool registrations. */
function extensionEntryPath(): string | undefined {
	try {
		return fileURLToPath(import.meta.url);
	} catch {
		return undefined;
	}
}

function isPlanModeContext(message: AgentMessage): boolean {
	const candidate = message as AgentMessage & { customType?: string };
	if (candidate.customType === "plan-mode-context") return true;
	if (candidate.role !== "user") return false;

	const content = candidate.content;
	if (typeof content === "string") return content.includes(PLAN_MODE_MARKER);
	if (Array.isArray(content)) {
		return content.some(
			(block) => block.type === "text" && (block as { text?: string }).text?.includes(PLAN_MODE_MARKER),
		);
	}
	return false;
}

export default function planMode(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("plan")) return;
	const policy = createPlanPolicy(pi);
	const runtime = createPlanRuntime(pi, policy, { entryPath: extensionEntryPath() });

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: (ctx) => {
			runtime.toggle(ctx);
			ctx.ui.notify(planModeNotice(runtime.isEnabled()), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_tree", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEYS.planMode, undefined));

	/**
	 * Whether the registered `subagent` tool declares the read-only parameter
	 * plan mode forces. A `subagent` that cannot honor it is refused rather than
	 * run read-write.
	 */
	const subagentSupportsReadOnly = (): boolean => {
		const info = pi.getAllTools().find((tool) => tool.name === SUBAGENT_TOOL);
		const properties = (info?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
		return properties !== undefined && Object.prototype.hasOwnProperty.call(properties, SUBAGENT_READ_ONLY_PARAM);
	};

	/**
	 * Why a tool call is blocked while planning, or undefined when it may
	 * proceed. Two layers: the policy (readers, `readOnlyHint`, deny list), then
	 * the path backstop (a hint on a path-carrying tool is only a claim).
	 */
	const blockedReason = (toolName: string, input: unknown): string | undefined => {
		// Plan-owned control tools are the sanctioned exception: `write_plan` saves
		// the artifact, `exit_plan_mode` presents it. The source-path check keeps a
		// same-named tool from another extension from borrowing the exemption.
		if (runtime.isControlTool(toolName)) return undefined;
		// `subagent` stays active, but only as read-only delegation. The flag is
		// forced in place (the child enforces it through `--tools`), so the model
		// cannot forget it; a `subagent` that does not declare the parameter is
		// refused rather than run read-write.
		if (toolName === SUBAGENT_TOOL) {
			if (!subagentSupportsReadOnly()) {
				return `Plan mode: the registered "${SUBAGENT_TOOL}" tool does not support read-only delegation; explore with the structured tools instead. ${BLOCKED_GUIDANCE}`;
			}
			if (typeof input === "object" && input !== null) {
				(input as Record<string, unknown>)[SUBAGENT_READ_ONLY_PARAM] = true;
			}
			return undefined;
		}
		const blocked = policy.check(toolName);
		if (blocked) return `Plan mode: ${blocked.reason}`;
		// `bash` is allowed by the policy so read-only git stays possible; this is
		// what actually restricts it to chained read-only git commands. The
		// Windows shell (`powershell`) is not in the policy allow list, so it is
		// blocked above, not here.
		if (toolName === "bash") {
			const command = (input as { command?: unknown } | undefined)?.command;
			if (typeof command !== "string" || command.trim() === "") {
				return `Plan mode: an empty bash command is not allowed. ${BASH_BLOCKED_GUIDANCE}`;
			}
			const verdict = checkReadOnlyGit(command);
			if (!verdict.ok) return `Plan mode: ${verdict.reason} ${BASH_BLOCKED_GUIDANCE}`;
		}
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
