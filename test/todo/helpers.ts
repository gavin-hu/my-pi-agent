import type { Todo } from "../../extensions/todo/types.ts";

export type AnyHandler = (...args: any[]) => any;

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	activeTools: string[];
}

/** Minimal `ExtensionAPI` double covering the surface the todo extension uses. */
export function makeFakePi(): FakePi {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, AnyHandler[]>();
	const activeTools: string[] = [];

	const pi: any = {
		handlers,
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, options: any) => commands.set(name, options),
		on: (event: string, handler: AnyHandler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools.splice(0, activeTools.length, ...names);
		},
		getAllTools: () => [...tools.values()],
	};

	return { pi, tools, commands, handlers, activeTools };
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

export async function emit(pi: any, event: string, payload: unknown, ctx: any): Promise<void> {
	for (const handler of pi.handlers.get(event) ?? []) await handler(payload, ctx);
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
