/**
 * Shared test doubles for the extension suite.
 *
 * `createFakePi` is a superset `ExtensionAPI` double: extensions only call the
 * methods they use, so one implementation covers every extension. Per-directory
 * helpers wrap it to expose the maps their tests inspect.
 */

export type AnyHandler = (...args: any[]) => any;

/** Identity theme so rendered text stays assertable. */
export const fakeTheme: any = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

/** Theme that tags text with the requested colour, to assert colour choices. */
export const coloringTheme: any = {
	fg: (color: string, text: string) => `[${color}]${text}`,
	bold: (text: string) => `[bold]${text}`,
};

/** A theme double that records every `fg(color, text)` call. */
export interface RecordingTheme {
	calls: Array<[string, string]>;
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** Build a theme that records colour tokens instead of styling text. */
export function makeRecordingTheme(): RecordingTheme {
	const calls: Array<[string, string]> = [];
	return {
		calls,
		fg: (color, text) => {
			calls.push([color, text]);
			return text;
		},
		bold: (text) => text,
	};
}

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	shortcuts: Map<string, any>;
	flags: Map<string, any>;
	entries: Array<{ type: string; customType: string; data?: unknown }>;
	handlers: Map<string, AnyHandler[]>;
	renderers: Map<string, any>;
	/** Legacy `{ customType, data }` view of appended entries. */
	appended: Array<{ customType: string; data?: unknown }>;
	sentMessages: Array<{ content: unknown; options: unknown }>;
	activeTools(): string[];
}

export interface FakePiOptions {
	/** Active tools at construction. */
	active?: string[];
	/** Defaults returned by `getFlag` for flags registered without one. */
	flagDefaults?: Record<string, unknown>;
	/** Override `getAllTools` (defaults to the registered tools). */
	allTools?: any[];
	/** Override `getSettings`. */
	settings?: unknown;
	/** Override `exec`; the default stub resolves a clean exit. */
	exec?: (
		command: string,
		args: string[],
		options?: { cwd?: string; timeout?: number },
	) => Promise<{ stdout: string; stderr: string; code: number; killed?: boolean }>;
}

/** Minimal synchronous `EventBus` double: real `on`/`emit`, matching Pi's sync emit. */
function createFakeEventBus() {
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	return {
		emit: (channel: string, data: unknown) => {
			for (const handler of listeners.get(channel) ?? []) handler(data);
		},
		on: (channel: string, handler: (data: unknown) => void) => {
			const set = listeners.get(channel) ?? new Set();
			set.add(handler);
			listeners.set(channel, set);
			return () => set.delete(handler);
		},
	};
}

/** Build a superset `ExtensionAPI` double, returning its maps for assertions. */
export function createFakePi(options: FakePiOptions = {}): FakePi {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const flags = new Map<string, any>();
	const entries: FakePi["entries"] = [];
	const handlers = new Map<string, AnyHandler[]>();
	const renderers = new Map<string, any>();
	const appended: Array<{ customType: string; data?: unknown }> = [];
	const sentMessages: Array<{ content: unknown; options: unknown }> = [];
	let active = [...(options.active ?? [])];

	const pi: any = {
		handlers,
		tools,
		commands,
		flags,
		entries,
		allTools: options.allTools ?? [],

		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		registerShortcut: (key: string, opts: any) => shortcuts.set(String(key), opts),
		registerEntryRenderer: (customType: string, renderer: any) => renderers.set(customType, renderer),
		registerFlag: (name: string, opts: any) => flags.set(name, opts),
		getFlag: (name: string) => flags.get(name)?.default ?? options.flagDefaults?.[name] ?? false,

		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
			appended.push({ customType, data });
		},
		sendUserMessage: (content: unknown, sendOptions?: unknown) => sentMessages.push({ content, options: sendOptions }),
		sendMessage: () => {},

		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active = [...new Set(names)];
		},
		getAllTools: () => (pi.allTools.length > 0 ? pi.allTools : [...tools.values()]),
		getSettings: () => options.settings ?? { compaction: { enabled: true } },

		events: createFakeEventBus(),
		exec: options.exec ?? (async () => ({ stdout: "", stderr: "", code: 0 })),
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
		renderers,
		appended,
		sentMessages,
		activeTools: () => [...active],
	};
}

/** Alias for `createFakePi`; most suites only need the default double. */
export const makeFakePi = createFakePi;

/** Run every handler registered for `event`. */
export async function emit(pi: any, event: string, payload: unknown, ctx: any): Promise<void> {
	for (const handler of pi.handlers.get(event) ?? []) await handler(payload, ctx);
}

/** Run every handler, collecting their results. */
export async function emitCollect(pi: any, event: string, payload: unknown, ctx: any): Promise<any[]> {
	const results: any[] = [];
	for (const handler of pi.handlers.get(event) ?? []) results.push(await handler(payload, ctx));
	return results;
}

/** Run every handler, returning the first defined result. */
export async function emitFirst(pi: any, event: string, payload: unknown, ctx: any): Promise<any> {
	let result: any;
	for (const handler of pi.handlers.get(event) ?? []) {
		const value = await handler(payload, ctx);
		if (value !== undefined && result === undefined) result = value;
	}
	return result;
}
