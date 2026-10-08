import { createFakePi, type AnyHandler } from "../helpers/fakes.ts";

export { emitCollect as emit } from "../helpers/fakes.ts";
export type { AnyHandler };

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

export interface FakeCtx {
	ctx: any;
	statusCalls: Array<{ key: string; text: unknown }>;
	notifications: string[];
	toolCalls: Array<{ name: string; args: unknown }>;
	setConfirm(value: boolean | undefined): void;
	setSelect(value: string | undefined): void;
	setEditor(value: string | undefined): void;
	setCustom(value: unknown): void;
	setExecuteError(value: boolean): void;
}

/** Minimal `ExtensionContext` double; `branch` is what `getBranch()` returns. */
export function fakeCtx(
	options: {
		mode?: string;
		hasUI?: boolean;
		cwd?: string;
		branch?: unknown[];
		confirm?: boolean | undefined;
		select?: string | undefined;
		editor?: string | undefined;
		custom?: unknown;
	} = {},
): FakeCtx {
	const statusCalls: Array<{ key: string; text: unknown }> = [];
	const notifications: string[] = [];
	const toolCalls: Array<{ name: string; args: unknown }> = [];
	let confirmResult = options.confirm;
	let selectResult = options.select;
	let editorResult = options.editor;
	let customResult = options.custom;
	let executeError = false;

	const ctx: any = {
		mode: options.mode ?? "rpc",
		hasUI: options.hasUI ?? true,
		cwd: options.cwd ?? process.cwd(),
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
			custom: async () => customResult,
		},
		executeTool: async (name: string, args: unknown) => {
			toolCalls.push({ name, args });
			return {
				isError: executeError,
				toolCall: { name, arguments: args },
				result: { content: [], details: undefined },
			};
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
		setCustom: (value) => {
			customResult = value;
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
