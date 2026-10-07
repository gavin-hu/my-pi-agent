import type { Goal } from "../../extensions/goal/types.ts";
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
	statusCalls: Array<{ key: string; text: unknown }>;
	notifications: string[];
}

/** Minimal `ExtensionContext` double; `branch` is what `getBranch()` returns. */
export function fakeCtx(options: { mode?: string; hasUI?: boolean; branch?: unknown[] } = {}): FakeCtx {
	const widgetCalls: Array<{ key: string; content: unknown }> = [];
	const statusCalls: Array<{ key: string; text: unknown }> = [];
	const notifications: string[] = [];
	const ctx: any = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		sessionManager: { getBranch: () => options.branch ?? [] },
		ui: {
			theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
			setWidget: (key: string, content: unknown) => widgetCalls.push({ key, content }),
			setStatus: (key: string, text: unknown) => statusCalls.push({ key, text }),
			notify: (message: string) => notifications.push(message),
			custom: async () => undefined,
		},
	};
	return { ctx, widgetCalls, statusCalls, notifications };
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

/** A user message carrying the goal marker. */
export function goalContextMessage(objective = "ship it"): unknown {
	return { role: "user", content: `[SESSION GOAL]\nThe user set this session goal: ${objective}` };
}

export function otherMessage(): unknown {
	return { role: "user", content: "just a normal message" };
}
