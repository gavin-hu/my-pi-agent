import type { Todo } from "../../extensions/todo/types.ts";
import { createFakePi, type AnyHandler } from "../helpers/fakes.ts";

export { emit } from "../helpers/fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	activeTools: string[];
}

/** Minimal `ExtensionAPI` double covering the surface the todo extension uses. */
export function makeFakePi(): FakePi {
	const fake = createFakePi();
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		handlers: fake.handlers,
		activeTools: fake.activeTools(),
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
			setWidget: (key: string, content: unknown) => widgetCalls.push({ key, content }),
			notify: (message: string) => notifications.push(message),
			custom: async () => undefined,
		},
	};
	return { ctx, widgetCalls, notifications };
}

/** A stored `todo` tool-result entry, as it appears on a session branch. */
export function resultEntry(todos: Todo[], toolName = "todo"): unknown {
	return {
		type: "message",
		message: { role: "toolResult", toolName, details: { todos, action: todos.length === 0 ? "clear" : "write" } },
	};
}

/** The last widget content set on a context, or undefined. */
export function lastWidget(calls: Array<{ key: string; content: unknown }>): unknown {
	return calls.at(-1)?.content;
}
