/**
 * Session-scoped state and tool gating for plan mode.
 *
 * Enabling plan mode removes the file-writing tools from the active set and
 * activates `exit_plan_mode`. Disabling restores them. The enabled flag is
 * persisted as a custom session entry so `/resume` and `/tree` follow the
 * branch, and it is also mirrored into the footer status.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanModeEntry } from "./types.ts";

/** Tool the model calls to leave plan mode after approval. */
export const EXIT_TOOL = "exit_plan_mode";
/** Tool the model calls to ask to enter plan mode. */
export const ENTER_TOOL = "enter_plan_mode";
/** Built-in tools removed while planning. */
export const RESTRICTED_TOOLS = ["write", "edit"] as const;
/** Custom-entry type used for persistence. */
export const STATE_TYPE = "plan-mode";

export interface PlanRuntime {
	/** Whether plan mode is currently on. */
	isEnabled(): boolean;
	enable(ctx: ExtensionContext): void;
	disable(ctx: ExtensionContext): void;
	toggle(ctx: ExtensionContext): void;
	/** Restore state from the branch and the `--plan` flag. */
	restore(ctx: ExtensionContext): void;
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

export function createPlanRuntime(pi: ExtensionAPI): PlanRuntime {
	let enabled = false;

	const applyTools = (): void => {
		const active = pi.getActiveTools();
		if (enabled) {
			const hidden = new Set<string>([...RESTRICTED_TOOLS, ENTER_TOOL]);
			pi.setActiveTools([...new Set([...active.filter((name) => !hidden.has(name)), EXIT_TOOL])]);
		} else {
			pi.setActiveTools(
				[...new Set([...active.filter((name) => name !== EXIT_TOOL), ...RESTRICTED_TOOLS, ENTER_TOOL])],
			);
		}
	};

	const setStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus("plan-mode", enabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined);
	};

	const setEnabled = (next: boolean, ctx: ExtensionContext | undefined, persist: boolean): void => {
		const changed = next !== enabled;
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
			const fromFlag = pi.getFlag("plan") === true;
			const restored = readPersistedEnabled(ctx);
			setEnabled(fromFlag || restored === true, ctx, false);
		},
	};
}
