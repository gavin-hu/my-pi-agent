/**
 * plan — a file-backed planning mode for Pi.
 *
 * While plan mode is on, tools that are not read-only are removed from the
 * active set or blocked: write and edit are hidden, bash is limited to a single
 * read-only git command, powershell is blocked, and everything else that mutates
 * (worktree, MCP tools) is blocked. `subagent` stays active but is forced
 * read-only. The one permitted write is `write_plan`,
 * which saves the plan in the agent directory. The model investigates, saves the
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
import { isExtensionEnabled } from "../../lib/env.ts";
import { requestMount } from "../../lib/http/index.ts";
import { sanitizeLine } from "../../lib/format.ts";
import { lastGoal, isPursuedGoal, type PublishedGoal } from "../../lib/goal-state.ts";
import { READ_ONLY_SUMMARY, PLAN_ENTER_REQUEST, type PlanEnterRequest } from "../../lib/plan-entry.ts";
import { isBoardRead } from "../../lib/policy.ts";
import { boardWriteRefusal } from "../../lib/board/actions.ts";
import { ASK_USER_QUESTION_TOOL, BOARD_TOOL, SUBAGENT_READ_ONLY_PARAM, SUBAGENT_TOOL } from "../../lib/tool-names.ts";
import { clip } from "../../lib/tui/columns.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { planModeNotice, registerCommands } from "./commands.ts";
import { createPlanPolicy, BASH_BLOCKED_GUIDANCE, BLOCKED_GUIDANCE, PLAN_SAFE_TOOLS } from "./policy.ts";
import { createPlanRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";
import { createLazyPlanWebReview } from "./web-lazy.ts";

/** Marker embedded in the injected prompt and used to filter stale context. */
export const PLAN_MODE_MARKER = "[PLAN MODE ACTIVE]";

/**
 * Longest goal text restated here. `goal` injects the full objective every turn
 * regardless of plan mode, so this line is a short pointer; the clip is what keeps
 * the whole context inside the prompt-budget ceiling.
 */
const GOAL_CONTEXT_CHARS = 64;

/**
 * Injected each turn while planning: the facts and the next action, not the tool
 * contracts. A pursued session goal — being planned or already final — becomes one
 * extra bullet, so a plan is designed against the objective instead of beside it.
 */
export function planModeContext(goal?: PublishedGoal | null): string {
	const lines = [
		PLAN_MODE_MARKER,
		"",
		`- Do not modify anything except the plan file: while planning, ${READ_ONLY_SUMMARY}.`,
		"- bash is git-only: read-only git commands chain with && or ; — no pipes, redirection, or substitution, and no powershell. The cwd is already the project root, so skip cd, and read files with read, grep, find, and ls.",
		"- Investigate and design a concrete plan, then save it with write_plan and call exit_plan_mode with the returned plan_path for approval.",
		"- Delegate broad exploration with subagent.",
		`- To choose between approaches, ask with ${ASK_USER_QUESTION_TOOL} before finalizing.`,
	];
	if (goal && isPursuedGoal(goal)) {
		lines.push(`- Current session goal: ${clip(sanitizeLine(goal.objective), GOAL_CONTEXT_CHARS)}`);
	}
	return lines.join("\n");
}

/** This extension entry file, as Pi records it for our tool registrations. */
function extensionEntryPath(): string | undefined {
	try {
		return fileURLToPath(import.meta.url);
	} catch {
		return undefined;
	}
}

function isPlanModeContext(message: AgentMessage): boolean {
	// Only the injected message carries this custom type. Matching on the marker
	// text would also capture (and drop) a real user message that contains it.
	return (message as AgentMessage & { customType?: string }).customType === "plan-mode-context";
}

export default function planMode(pi: ExtensionAPI): void {
	if (!isExtensionEnabled("plan")) return;
	const policy = createPlanPolicy(pi);
	const runtime = createPlanRuntime(pi, policy, { entryPath: extensionEntryPath() });
	/** The session this review serves as; its prefix lands on that session's one server. */
	let sessionId = "";
	const web = createLazyPlanWebReview(runtime.plans, {
		mount: (spec) => requestMount(pi, spec),
		session: () => sessionId,
	});

	registerTools(pi, runtime, web);
	registerCommands(pi, runtime, web);

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

	// Another extension that offers plan mode (the goal workflow) asks on this
	// channel instead of calling a tool it cannot reach from a command context. It
	// owns the user's answer; enabling here must therefore not ask again.
	const unsubscribes: Array<() => void> = [];
	const listenForEntryRequests = (): void => {
		for (const unsubscribe of unsubscribes) unsubscribe();
		unsubscribes.length = 0;
		unsubscribes.push(
			pi.events.on(PLAN_ENTER_REQUEST, (data) => {
				const request = data as Partial<PlanEnterRequest> | undefined;
				if (!request?.ctx || typeof request.respond !== "function") return;
				if (!runtime.isEnabled()) runtime.enable(request.ctx);
				request.respond(true);
			}),
		);
	};

	pi.on("session_start", (_event, ctx) => {
		listenForEntryRequests();
		runtime.restore(ctx);
	});
	pi.on("session_tree", (_event, ctx) => runtime.restore(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		await web.closeAll();
		for (const unsubscribe of unsubscribes) unsubscribe();
		unsubscribes.length = 0;
		ctx.ui.setStatus(STATUS_KEYS.planMode, undefined);
	});

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
	const blockedReason = async (toolName: string, input: unknown): Promise<string | undefined> => {
		// Plan-owned tools are the sanctioned exception: `write_plan` saves the
		// artifact, `exit_plan_mode` presents it, `cancel_plan_mode` restores access,
		// and `enter_plan_mode` answers "already" to a call that was in flight when
		// plan mode came on. The source-path check keeps a same-named tool from
		// another extension from borrowing the exemption.
		if (runtime.isOwnTool(toolName)) return undefined;
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
		// `board` stays active so planning can read the board it is about to add cards
		// to. The action is the truth here, not the annotation: the same tool writes, so
		// `readOnlyHint` cannot say it, and every verb but the reads are refused by name.
		if (toolName === BOARD_TOOL) {
			if (isBoardRead(input)) return undefined;
			return boardWriteRefusal((input as { action?: unknown } | undefined)?.action, BLOCKED_GUIDANCE);
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
			const { checkReadOnlyGit } = await import("./git-bash.ts");
			const verdict = checkReadOnlyGit(command);
			if (!verdict.ok) return `Plan mode: ${verdict.reason} ${BASH_BLOCKED_GUIDANCE}`;
		}
		const { hasPathInput } = await import("./path-guard.ts");
		if (hasPathInput(input) && !PLAN_SAFE_TOOLS.includes(toolName)) {
			return `Plan mode: "${toolName}" takes a file path and is not a known reader. ${BLOCKED_GUIDANCE}`;
		}
		return undefined;
	};

	// Block anything that is not read-only while planning. The active-set gating
	// above hides most of these; this is the second layer for tools already
	// declared in an in-flight request, and the guard for tools we did not know
	// about when the extension loaded (MCP servers, future extensions).
	pi.on("tool_call", async (event) => {
		if (!runtime.isEnabled()) return undefined;
		const reason = await blockedReason(event.toolName, event.input);
		return reason ? { block: true, reason } : undefined;
	});

	// Tell the model it is planning, and restate an active goal so the plan is
	// designed against it. Reads the branch, so no extra model call is involved.
	pi.on("before_agent_start", (_event, ctx) => {
		if (!runtime.isEnabled()) return undefined;
		const goal = lastGoal(ctx.sessionManager.getBranch());
		return { message: { customType: "plan-mode-context", content: planModeContext(goal), display: false } };
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
