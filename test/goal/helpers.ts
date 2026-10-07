import type { Goal } from "../../extensions/goal/types.ts";
import { GOAL_CONTEXT_TYPE } from "../../extensions/goal/index.ts";
import { createFakePi, type AnyHandler } from "../helpers/fakes.ts";

export { emitCollect as emit } from "../helpers/fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	entries: Array<{ type: string; customType: string; data?: unknown }>;
}

/** Minimal `ExtensionAPI` double covering the surface the goal extension uses. */
export function makeFakePi(): FakePi {
	const fake = createFakePi();
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		handlers: fake.handlers,
		entries: fake.entries,
	};
}

export interface FakeCtx {
	ctx: any;
	widgetCalls: Array<{ key: string; content: unknown }>;
	notifications: string[];
}

/** Minimal `ExtensionContext` double; `branch` is what `getBranch()` returns. */
export function fakeCtx(options: { mode?: string; hasUI?: boolean; branch?: unknown[] } = {}): FakeCtx {
	const widgetCalls: Array<{ key: string; content: unknown }> = [];
	const notifications: string[] = [];
	const ctx: any = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		sessionManager: { getBranch: () => options.branch ?? [] },
		ui: {
			theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
			setWidget: (key: string, content: unknown) => widgetCalls.push({ key, content }),
			notify: (message: string) => notifications.push(message),
			custom: async () => undefined,
		},
	};
	return { ctx, widgetCalls, notifications };
}

/** A stored `goal` tool-result entry, as it appears on a session branch. */
export function resultEntry(goal: Goal | null, toolName = "goal"): unknown {
	const action = goal === null ? "clear" : goal.status === "achieved" ? "achieve" : "set";
	return { type: "message", message: { role: "toolResult", toolName, details: { goal, action } } };
}

/** The last widget content set on a context, or undefined. */
export function lastWidget(calls: Array<{ key: string; content: unknown }>): unknown {
	return calls.at(-1)?.content;
}

/** The injected goal context message, as it appears in `context` messages. */
export function goalContextMessage(objective = "ship it"): unknown {
	return {
		role: "custom",
		customType: GOAL_CONTEXT_TYPE,
		content: `The user set this session goal: ${objective}`,
		display: false,
	};
}

export function otherMessage(): unknown {
	return { role: "user", content: "just a normal message" };
}
