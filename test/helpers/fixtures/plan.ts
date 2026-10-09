import { createFakePi, type AnyHandler } from "../fakes.ts";
import { fakeCtx as sharedFakeCtx, type FakeCtxOptions, type FakeCtxResult } from "../context.ts";

export interface FakePi {
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
export function makeFakePi(options: { active?: string[]; planFlag?: boolean; exec?: any } = {}): FakePi {
	const defaultActive = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	const fake = createFakePi({ active: options.active ?? defaultActive, exec: options.exec });
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

/** A plan-mode context: RPC by default so `ctx.mode === "tui"` branches stay off. */
export function fakeCtx(options: FakeCtxOptions = {}): FakeCtxResult {
	return sharedFakeCtx({ mode: "rpc", hasUI: true, ...options });
}

/** A persisted plan-mode custom entry. */
export function stateEntry(enabled: boolean): unknown {
	return { type: "custom", customType: "plan-mode", data: { enabled } };
}

/** A user message carrying the plan-mode marker. */
export function planModeMessage(): unknown {
	return { role: "user", content: "[PLAN MODE ACTIVE] investigate" };
}

/** A fixed local date for deterministic plan-stamp and store-clock tests. */
export function fixedPlanDate(): Date {
	return new Date(2026, 9, 8, 15, 30); // 2026-10-08 15:30 local
}
