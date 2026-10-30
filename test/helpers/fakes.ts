/**
 * Shared test doubles for the extension suite.
 *
 * `createFakePi` is a superset `ExtensionAPI` double: extensions only call the
 * methods they use, so one implementation covers every extension. Per-directory
 * helpers wrap it to expose the maps their tests inspect.
 */

import type { MarkdownTransformer, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, Component } from "@earendil-works/pi-tui";

export type AnyHandler = (...args: any[]) => any;

/** Identity theme so rendered text stays assertable. */
export const fakeTheme: any = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

/** A stand-in for a component's inner renderer, recording the width it was asked for. */
export function innerOf(lines: string[], onWidth?: (width: number) => void): Component {
	return {
		render: (width) => {
			onWidth?.(width);
			return lines;
		},
		invalidate: () => {},
	};
}

/**
 * Markdown theme double. With the default identity `fakeTheme` the rendered
 * plan stays plain text; pass {@link coloringTheme} to assert color choices.
 */
export function fakeMarkdownTheme(theme: any = fakeTheme): MarkdownTheme {
	return {
		heading: (text) => theme.fg("mdHeading", text),
		link: (text) => theme.fg("mdLink", text),
		linkUrl: (text) => theme.fg("mdLinkUrl", text),
		code: (text) => theme.fg("mdCode", text),
		codeBlock: (text) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
		quote: (text) => theme.fg("mdQuote", text),
		quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
		hr: (text) => theme.fg("mdHr", text),
		listBullet: (text) => theme.fg("mdListBullet", text),
		bold: (text) => theme.bold(text),
		italic: (text) => text,
		underline: (text) => text,
		strikethrough: (text) => text,
	};
}

/** Theme that tags text with the requested colour, to assert colour choices. */
export const coloringTheme: any = {
	fg: (color: string, text: string) => `[${color}]${text}`,
	bg: (color: string, text: string) => `[bg:${color}]${text}`,
	bold: (text: string) => `[bold]${text}`,
};

/**
 * Theme that emits real SGR codes, so a test can assert that renderer
 * sanitization does not strip the theme's own ANSI escapes.
 */
export const ansiTheme: any = {
	fg: (_color: string, text: string) => `\u001b[38;2;0;0;0m${text}\u001b[39m`,
	bold: (text: string) => text,
};

/**
 * Theme that brackets every painted run, `[[role]]text[/]`, so a test can tell
 * painted text from text that would fall through to the terminal's own colour.
 *
 * Printable brackets rather than control characters: the width helpers strip
 * control characters, which would eat the markers before a test could read them.
 */
export const bracketedTheme: any = {
	fg: (role: string, text: string) => `[[${role}]]${text}[/]`,
	bg: (_role: string, text: string) => text,
	bold: (text: string) => text,
};

/**
 * What {@link bracketedTheme} did not bracket: the text left in the terminal's own
 * colour. A complete run first, then a marker whose run the width clipped, and
 * finally any escape and the `...` pi-tui appends when it clips a line.
 */
export function unpaintedText(lines: readonly string[]): string {
	return lines
		.join("\n")
		.replace(/\[\[[^\]]*\]\][^[]*\[\/\]/g, "")
		.replace(/\[\/?[^\]]*\]\]/g, "")
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\u001b/g, "")
		.replace(/\.\.\./g, "");
}

/** The real SGR a {@link roleSgrTheme} colour token opens with. */
export const ROLE_SGR = {
	accent: "\u001b[38;2;1;1;1m",
	// The shipped themes alias the tool-title token to the accent; mirror that.
	toolTitle: "\u001b[38;2;1;1;1m",
	text: "\u001b[38;2;2;2;2m",
	other: "\u001b[38;2;3;3;3m",
} as const;

/**
 * Theme that emits a distinct real SGR per colour token, so a test can tell two
 * roles apart after wrapping re-emits them (a tag double is not an escape, so
 * `Text` cannot carry it across a wrap).
 */
export const roleSgrTheme: any = {
	fg: (color: string, text: string) =>
		`${color in ROLE_SGR ? ROLE_SGR[color as keyof typeof ROLE_SGR] : ROLE_SGR.other}${text}\u001b[39m`,
	bold: (text: string) => text,
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
	/** Renderers passed to `registerMessageRenderer`, keyed by custom type. */
	messageRenderers: Map<string, any>;
	/** Tool-renderer resolvers passed to `registerToolRenderer`, in order. */
	toolRenderers: ToolRendererResolver[];
	/** Transformers passed to `registerMarkdownTransformer`, in registration order. */
	markdownTransformers: MarkdownTransformer[];
	/** Legacy `{ customType, data }` view of appended entries. */
	appended: Array<{ customType: string; data?: unknown }>;
	sentMessages: Array<{ content: unknown; options: unknown }>;
	/** Messages sent with `sendMessage`, in order. */
	customMessages: Array<{ message: any; options: unknown }>;
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
	const messageRenderers = new Map<string, any>();
	const toolRenderers: ToolRendererResolver[] = [];
	const markdownTransformers: MarkdownTransformer[] = [];
	const appended: Array<{ customType: string; data?: unknown }> = [];
	const sentMessages: Array<{ content: unknown; options: unknown }> = [];
	const customMessages: Array<{ message: any; options: unknown }> = [];
	let active = [...(options.active ?? [])];
	let sessionName: string | undefined;

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
		registerMessageRenderer: (customType: string, renderer: any) => messageRenderers.set(customType, renderer),
		registerToolRenderer: (resolver: ToolRendererResolver) => toolRenderers.push(resolver),
		registerMarkdownTransformer: (transformer: MarkdownTransformer) => markdownTransformers.push(transformer),
		registerFlag: (name: string, opts: any) => flags.set(name, opts),
		getFlag: (name: string) => flags.get(name)?.default ?? options.flagDefaults?.[name] ?? false,

		appendEntry: (customType: string, data?: unknown) => {
			entries.push({ type: "custom", customType, data });
			appended.push({ customType, data });
		},
		sendUserMessage: (content: unknown, sendOptions?: unknown) => sentMessages.push({ content, options: sendOptions }),
		sendMessage: (message: any, sendOptions?: unknown) => customMessages.push({ message, options: sendOptions }),

		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active = [...new Set(names)];
		},
		setSessionName: (name: string) => {
			sessionName = name;
		},
		getSessionName: () => sessionName,
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
		messageRenderers,
		toolRenderers,
		markdownTransformers,
		appended,
		sentMessages,
		customMessages,
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
