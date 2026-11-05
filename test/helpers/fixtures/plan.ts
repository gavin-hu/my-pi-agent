import { join } from "node:path";
import { PLAN_TOOL } from "../../../lib/tool-names.ts";
import { createPlanPolicy } from "../../../extensions/plan/policy.ts";
import { createPlanRuntime, type PlanRuntime } from "../../../extensions/plan/runtime.ts";
import { toolResultEntry } from "../entries.ts";
import { createFakePi, type AnyHandler } from "../fakes.ts";
import { fakeCtx, type FakeCtxOptions, type FakeCtxResult } from "../context.ts";

export interface PlanPi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	shortcuts: Map<string, any>;
	flags: Map<string, any>;
	entries: Array<{ type: string; customType: string; data?: unknown }>;
	handlers: Map<string, AnyHandler[]>;
	sentMessages: Array<{ content: unknown; options: unknown }>;
	activeTools(): string[];
}

/** Minimal `ExtensionAPI` double covering the surface the plan-mode extension uses. */
export function makePlanPi(
	options: { active?: string[]; planFlag?: boolean; exec?: any; allTools?: any[] } = {},
): PlanPi {
	const defaultActive = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	const fake = createFakePi({
		active: options.active ?? defaultActive,
		exec: options.exec,
		allTools: options.allTools,
	});
	fake.pi.registerFlag = (name: string, opts: any) => {
		fake.flags.set(name, { ...opts, default: name === "plan" && options.planFlag ? true : opts.default });
	};
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		shortcuts: fake.shortcuts,
		flags: fake.flags,
		entries: fake.entries,
		handlers: fake.handlers,
		sentMessages: fake.sentMessages,
		activeTools: fake.activeTools,
	};
}

/**
 * A pi whose `git rev-parse` reports `root` as the repository root, so a plan store keys on
 * `root`'s common git directory instead of landing in the unkeyed directory.
 */
export function planRepoPi(root: string): any {
	return createFakePi({
		exec: async (command: string, args: string[]) => {
			if (command !== "git" || args[0] !== "rev-parse") return { stdout: "", stderr: "", code: 1 };
			const out = args.includes("--git-common-dir") ? join(root, ".git") : root;
			return { stdout: `${out}\n`, stderr: "", code: 0 };
		},
	}).pi;
}

/** A plan-mode context: RPC by default so `ctx.mode === "tui"` branches stay off. */
export function planCtx(options: FakeCtxOptions = {}): FakeCtxResult {
	return fakeCtx({ mode: "rpc", hasUI: true, ...options });
}

/** A persisted plan-mode custom entry. */
export function stateEntry(enabled: boolean, removed?: string[]): unknown {
	return { type: "custom", customType: "plan-mode", data: removed === undefined ? { enabled } : { enabled, removed } };
}

/** An injected plan-mode context message, as `before_agent_start` returns it. */
export function planModeMessage(): unknown {
	return { role: "custom", customType: "plan-mode-context", content: "[PLAN MODE ACTIVE] investigate" };
}

/** A fixed local date for deterministic plan-stamp and store-clock tests. */
export function fixedPlanDate(): Date {
	return new Date(2026, 9, 8, 15, 30); // 2026-10-08 15:30 local
}

/** A persisted plan-baseline custom entry. */
export function baselineEntry(
	path: string,
	sections: Array<{ title: string; digest: string; blocks?: string[] }>,
): unknown {
	return { type: "custom", customType: "plan-baseline", data: { path, sections } };
}

/** A successful `plan` `write` result, which is the one fact the footer chip replays after a restore. */
export function writeEntry(path: string): unknown {
	return toolResultEntry(PLAN_TOOL, { action: "write", path, relativePath: path, bytes: 12 });
}

/**
 * A plan runtime over a fake pi, with the context that drives it and the branch a restore
 * reads. The one shape both runtime suites build, so neither declares its own.
 */
export function planRuntimeSetup(
	options: { active?: string[]; planFlag?: boolean; branch?: unknown[] } = {},
): PlanPi & { runtime: PlanRuntime; ctx: FakeCtxResult["ctx"]; statusCalls: FakeCtxResult["statusCalls"] } {
	const fake = makePlanPi({
		active: options.active ?? ["read", "bash", "write", "edit", PLAN_TOOL, "todo"],
		planFlag: options.planFlag,
	});
	if (options.planFlag) fake.flags.set("plan", { default: true });
	const runtime = createPlanRuntime(fake.pi, createPlanPolicy(fake.pi));
	const { ctx, statusCalls } = planCtx({ branch: options.branch });
	return { ...fake, runtime, ctx, statusCalls };
}
