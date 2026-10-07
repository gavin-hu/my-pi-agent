/**
 * The guard policy (pure). Turns one `tool_call` into a verdict that
 * `index.ts` renders as UI and a block result.
 *
 * Precedence: disabled → allow; protected path; dangerous command; destructive
 * annotation. A block from another extension (worktree, plan-mode) has already
 * short-circuited `tool_call` before guard runs, so guard only sees calls those
 * extensions let through.
 */

import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { analyzeCommand } from "./commands.ts";
import type { GuardConfig } from "./config.ts";
import { decidePath, resolveInput } from "./paths.ts";
import type { GuardVerdict } from "./types.ts";

export interface ToolCallAssessment {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
	config: GuardConfig;
	annotations?: ToolAnnotations;
}

/** Tools whose `path` argument is checked against the protected patterns. */
const WRITE_TOOLS = new Set(["write", "edit"]);

/** Shell tools whose command line is analyzed. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

/**
 * Tools to leave out of the broad missing-hints heuristic: the built-ins and
 * this package's own tools, which either carry hints or are handled elsewhere.
 */
const KNOWN_TOOLS = new Set([
	"read",
	"write",
	"edit",
	"bash",
	"powershell",
	"grep",
	"find",
	"ls",
	"todo",
	"ask_user_question",
	"web_search",
	"web_fetch",
	"worktree_enter",
	"worktree_exit",
	"worktree_prune",
	"worktree_status",
	"enter_plan_mode",
	"exit_plan_mode",
]);

function annotationVerdict(item: ToolCallAssessment): GuardVerdict | undefined {
	const { toolName, annotations, config } = item;
	if (config.annotations.confirmDestructive && annotations?.destructiveHint === true) {
		return {
			action: "confirm",
			reason: `${toolName} is marked destructive`,
			kind: "annotation",
			detail: toolName,
		};
	}
	if (config.annotations.confirmMissingHints && !KNOWN_TOOLS.has(toolName)) {
		const readOnly = annotations?.readOnlyHint === true;
		const destructive = annotations?.destructiveHint !== false;
		const openWorld = annotations?.openWorldHint !== false;
		if (!readOnly && (destructive || openWorld)) {
			return {
				action: "confirm",
				reason: `${toolName} has no read-only annotation; confirm before running`,
				kind: "annotation",
				detail: toolName,
			};
		}
	}
	return undefined;
}

/** Assess one tool call against the guard config. */
export function assessToolCall(item: ToolCallAssessment): GuardVerdict {
	const { toolName, input, cwd, config } = item;
	if (!config.enabled) return { action: "allow" };

	if (WRITE_TOOLS.has(toolName)) {
		const path = typeof input.path === "string" ? input.path : undefined;
		if (path) {
			const decision = decidePath(resolveInput(cwd, path), cwd, config);
			if (decision) {
				return { action: decision.action, reason: decision.reason, kind: "path", detail: decision.detail };
			}
		}
	}

	if (SHELL_TOOLS.has(toolName)) {
		const command = typeof input.command === "string" ? input.command : "";
		if (command.trim()) {
			const verdict = analyzeCommand(command, config);
			if (verdict.risk !== "safe") {
				return { action: verdict.risk, reason: verdict.reason, kind: "command", detail: command.trim() };
			}
		}
	}

	return annotationVerdict(item) ?? { action: "allow" };
}
