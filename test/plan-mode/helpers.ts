export type AnyHandler = (...args: any[]) => any;

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	shortcuts: Map<string, any>;
	flags: Map<string, any>;
	entries: Array<{ customType: string; data: unknown }>;
	handlers: Map<string, AnyHandler[]>;
	sentMessages: Array<{ content: unknown; options: unknown }>;
	activeTools(): string[];
}

/** Minimal `ExtensionAPI` double covering the surface the plan-mode extension uses. */
export function makeFakePi(
	options: { active?: string[]; planFlag?: boolean } = {},
): FakePi {
	const defaultActive = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	let active = [...(options.active ?? defaultActive)];
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const flags = new Map<string, any>();
	const entries: Array<{ customType: string; data: unknown }> = [];
	const handlers = new Map<string, AnyHandler[]>();
	const sentMessages: Array<{ content: unknown; options: unknown }> = [];

	const pi: any = {
		handlers,
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		registerShortcut: (key: string, opts: any) => shortcuts.set(String(key), opts),
		registerFlag: (name: string, opts: any) => {
			flags.set(name, { ...opts, default: name === "plan" && options.planFlag ? true : opts.default });
		},
		getFlag: (name: string) => flags.get(name)?.default ?? false,
		appendEntry: (customType: string, data?: unknown) => entries.push({ customType, data }),
		sendUserMessage: (content: unknown, options?: unknown) => sentMessages.push({ content, options }),
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active = [...new Set(names)];
		},
		getAllTools: () => [...tools.values()],
		on: (event: string, handler: AnyHandler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	};

	return {
		pi,
		tools,
		commands,
		shortcuts,
		flags,
		entries,
		handlers,
		sentMessages,
		activeTools: () => [...active],
	};
}

export interface FakeCtx {
	ctx: any;
	statusCalls: Array<{ key: string; text: unknown }>;
	notifications: string[];
	toolCalls: Array<{ name: string; args: unknown }>;
	setConfirm(value: boolean | undefined): void;
	setSelect(value: string | undefined): void;
	setEditor(value: string | undefined): void;
	setExecuteError(value: boolean): void;
}

/** Minimal `ExtensionContext` double; `branch` is what `getBranch()` returns. */
export function fakeCtx(
	options: {
		mode?: string;
		hasUI?: boolean;
		branch?: unknown[];
		confirm?: boolean | undefined;
		select?: string | undefined;
		editor?: string | undefined;
	} = {},
): FakeCtx {
	const statusCalls: Array<{ key: string; text: unknown }> = [];
	const notifications: string[] = [];
	const toolCalls: Array<{ name: string; args: unknown }> = [];
	let confirmResult = options.confirm;
	let selectResult = options.select;
	let editorResult = options.editor;
	let executeError = false;

	const ctx: any = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		isIdle: () => true,
		sessionManager: { getBranch: () => options.branch ?? [] },
		tools: [],
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			setStatus: (key: string, text: unknown) => statusCalls.push({ key, text }),
			notify: (message: string) => notifications.push(message),
			confirm: async () => confirmResult,
			select: async () => selectResult,
			editor: async () => editorResult,
		},
		executeTool: async (name: string, args: unknown) => {
			toolCalls.push({ name, args });
			return { isError: executeError, toolCall: { name, arguments: args }, result: { content: [], details: undefined } };
		},
	};

	return {
		ctx,
		statusCalls,
		notifications,
		toolCalls,
		setConfirm: (value) => {
			confirmResult = value;
		},
		setSelect: (value) => {
			selectResult = value;
		},
		setEditor: (value) => {
			editorResult = value;
		},
		setExecuteError: (value) => {
			executeError = value;
		},
	};
}

/** A persisted plan-mode custom entry. */
export function stateEntry(enabled: boolean): unknown {
	return { type: "custom", customType: "plan-mode", data: { enabled } };
}

/** A user message carrying the plan-mode marker. */
export function planModeMessage(): unknown {
	return { role: "user", content: "[PLAN MODE ACTIVE] investigate" };
}

export function otherMessage(): unknown {
	return { role: "user", content: "just a normal message" };
}

export async function emit(pi: any, event: string, payload: unknown, ctx: any): Promise<any[]> {
	const results: any[] = [];
	for (const handler of pi.handlers.get(event) ?? []) results.push(await handler(payload, ctx));
	return results;
}
