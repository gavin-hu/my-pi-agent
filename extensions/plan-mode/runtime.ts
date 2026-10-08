/**
 * Session-scoped state and tool gating for plan mode.
 *
 * Enabling plan mode removes every tool the policy does not consider read-only
 * from the active set and activates the plan-mode control tools: `exit_plan_mode`
 * (present the plan for approval) and `write_plan` (save the plan artifact under
 * `.pi/plans`). Disabling restores exactly what it hid. The enabled flag is
 * persisted as a custom session entry so `/resume` and `/tree` follow the
 * branch, and it is also mirrored into the footer status.
 *
 * `write_plan` is the one sanctioned write while planning. The read-only guard
 * in `index.ts` permits a control tool only when the registered tool is this
 * extension's own (matched by source path), so a same-named tool from another
 * extension cannot borrow the exemption.
 */

import { basename, resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReadOnlyPolicy } from "../_shared/policy.ts";
import { createPlanStore, type PlanStore } from "./plans.ts";
import type { PlanModeEntry } from "./types.ts";

/** Tool the model calls to leave plan mode after approval. */
export const EXIT_TOOL = "exit_plan_mode";
/** Tool the model calls to ask to enter plan mode. */
export const ENTER_TOOL = "enter_plan_mode";
/** Tool the model calls to save the plan artifact. */
export const WRITE_PLAN_TOOL = "write_plan";
/** Custom-entry type used for persistence. */
export const STATE_TYPE = "plan-mode";

/** Longest plan-file basename shown in the footer chip. */
const STATUS_NAME_LENGTH = 28;

/** Tools plan mode activates itself; the guard permits only this extension's own. */
const CONTROL_TOOLS = [EXIT_TOOL, WRITE_PLAN_TOOL];

export interface PlanRuntime {
	/** Whether plan mode is currently on. */
	isEnabled(): boolean;
	enable(ctx: ExtensionContext): void;
	disable(ctx: ExtensionContext): void;
	toggle(ctx: ExtensionContext): void;
	/** Restore state from the branch and the `--plan` flag. */
	restore(ctx: ExtensionContext): void;
	/** Plan-file storage for `write_plan` and `exit_plan_mode`. */
	plans: PlanStore;
	/** Whether `toolName` is a plan-owned control tool (not a same-named impostor). */
	isControlTool(toolName: string): boolean;
	/** Path of the most recently written plan, for the footer chip. */
	lastPlanPath(): string | undefined;
	/** Remember a written plan and repaint the footer. */
	setLastPlan(ctx: ExtensionContext, path: string): void;
}

function readPersistedEnabled(ctx: ExtensionContext): boolean | undefined {
	let enabled: boolean | undefined;
	for (const raw of ctx.sessionManager.getBranch()) {
		const entry = raw as { type?: string; customType?: string; data?: PlanModeEntry };
		if (entry.type === "custom" && entry.customType === STATE_TYPE && typeof entry.data?.enabled === "boolean") {
			enabled = entry.data.enabled;
		}
	}
	return enabled;
}

/** Compare two paths, resolving symlinks when possible so `/tmp` and `/private/tmp` match. */
function samePath(a: string, b: string): boolean {
	const normalize = (path: string): string => {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	};
	return normalize(a) === normalize(b);
}

/** One terminal-safe line for the footer chip. */
function statusName(path: string): string {
	const name = basename(path).replace(/\.md$/i, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
	if (!name) return "plan";
	return name.length > STATUS_NAME_LENGTH ? `${name.slice(0, STATUS_NAME_LENGTH - 1)}…` : name;
}

export function createPlanRuntime(
	pi: ExtensionAPI,
	policy: ReadOnlyPolicy,
	options: { entryPath?: string } = {},
): PlanRuntime {
	let enabled = false;
	let lastPlanPath: string | undefined;
	// Tools plan mode deactivated, so disabling restores exactly those and does
	// not re-activate a tool another extension intentionally hid.
	let removedForPlan: string[] = [];

	const plans = createPlanStore(pi);

	const isControlTool = (toolName: string): boolean => {
		if (!CONTROL_TOOLS.includes(toolName)) return false;
		const info = pi.getAllTools().find((tool) => tool.name === toolName);
		const source = info?.sourceInfo?.path;
		// Older hosts may not record a source; only reject a recorded mismatch.
		return source === undefined || options.entryPath === undefined || samePath(source, options.entryPath);
	};

	const applyTools = (): void => {
		const active = pi.getActiveTools();
		if (enabled) {
			// Keep only tools the policy considers safe to expose while read-only
			// (structured readers and the plan/goal trackers) plus the control tools.
			pi.setActiveTools([...new Set([...active.filter((name) => policy.isAllowed(name)), ...CONTROL_TOOLS])]);
		} else {
			pi.setActiveTools([...new Set([...active.filter((name) => !CONTROL_TOOLS.includes(name)), ...removedForPlan])]);
			removedForPlan = [];
		}
	};

	const statusText = (): string => (lastPlanPath ? `⏸ plan · ${statusName(lastPlanPath)}` : "⏸ plan");

	const setStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus("plan-mode", enabled ? ctx.ui.theme.fg("warning", statusText()) : undefined);
	};

	const setEnabled = (next: boolean, ctx: ExtensionContext | undefined, persist: boolean): void => {
		const changed = next !== enabled;
		// Capture what we hide only when entering plan mode. A redundant enable (for
		// example a `session_tree` restore while already enabled) must not recompute
		// this from the already-filtered active set, or disabling would lose them.
		if (changed && next) {
			removedForPlan = [...new Set(pi.getActiveTools().filter((name) => !policy.isAllowed(name) && !CONTROL_TOOLS.includes(name)))];
		}
		enabled = next;
		applyTools();
		if (persist && changed) pi.appendEntry(STATE_TYPE, { enabled } satisfies PlanModeEntry);
		if (ctx) setStatus(ctx);
	};

	return {
		isEnabled: () => enabled,
		enable: (ctx) => setEnabled(true, ctx, true),
		disable: (ctx) => setEnabled(false, ctx, true),
		toggle: (ctx) => setEnabled(!enabled, ctx, true),
		restore: (ctx) => {
			lastPlanPath = undefined;
			const restored = readPersistedEnabled(ctx);
			// `--plan` starts a fresh session in plan mode; an explicit persisted
			// choice (including a later disable) wins over the launch flag.
			const fromFlag = restored === undefined && pi.getFlag("plan") === true;
			setEnabled(fromFlag || restored === true, ctx, false);
		},
		plans,
		isControlTool,
		lastPlanPath: () => lastPlanPath,
		setLastPlan: (ctx, path) => {
			lastPlanPath = path;
			setStatus(ctx);
		},
	};
}
