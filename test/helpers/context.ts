/**
 * Shared `ExtensionContext` double.
 *
 * One builder covers every extension's needs; extensions that need a different
 * default (mode, `hasUI`, session plumbing) wrap it in their fixture module
 * rather than re-declaring the context. All recorded arrays are also attached
 * to `ctx` so tests that read `ctx.statuses` / `ctx.notices` keep working.
 */

import { fakeTheme } from "./fakes.ts";

export interface FakeCtxOptions {
	/** Defaults to `"tui"`. `hasUI` defaults to `mode === "tui"`. */
	mode?: string;
	hasUI?: boolean;
	cwd?: string;
	sessionId?: string;
	leafId?: string;
	/** Branch entries returned by `sessionManager.getBranch`. */
	branch?: unknown[];
	/** Entries returned by `sessionManager.getEntries`; defaults to `branch`. */
	entries?: unknown[];
	sessionName?: string | undefined;
	/** Result of the first `ui.confirm`; `undefined` means no selection. */
	confirm?: boolean | undefined;
	/** Result or queue of results for `ui.select`. */
	select?: string | undefined | Array<string | undefined>;
	/** Result or queue of results for `ui.editor`. */
	editor?: string | undefined | Array<string | undefined>;
	input?: string | undefined;
	custom?: unknown;
	theme?: { fg(color: string, text: string): string; bold?(text: string): string };
	isIdle?: () => boolean;
	navigateTree?: (targetId: string) => unknown;
	executeError?: boolean;
	/** Extra fields merged onto the context (and context UI) after construction. */
	extra?: Record<string, unknown>;
}

export interface FakeCtxResult {
	ctx: any;
	/** Notification messages, in call order. */
	notifications: string[];
	/** Notification messages with the optional second argument. */
	notices: Array<{ message: string; kind?: string }>;
	statuses: Map<string, string | undefined>;
	widgets: Map<string, unknown>;
	widgetCalls: Array<{ key: string; content: unknown }>;
	statusCalls: Array<{ key: string; text: unknown }>;
	toolCalls: Array<{ name: string; args: unknown }>;
	selects: string[][];
	navigations: string[];
	editorSets: string[];
	customCalls: any[];
	setConfirm(value: boolean | undefined): void;
	setSelect(value: string | undefined | Array<string | undefined>): void;
	setEditor(value: string | undefined | Array<string | undefined>): void;
	setCustom(value: unknown): void;
	setExecuteError(value: boolean): void;
}

type DialogResult = string | undefined;

/** Build a superset `ExtensionContext` double, returning its recorder arrays. */
export function fakeCtx(options: FakeCtxOptions = {}): FakeCtxResult {
	const mode = options.mode ?? "tui";
	const hasUI = options.hasUI ?? mode === "tui";
	const cwd = options.cwd ?? process.cwd();
	const branch = options.branch ?? [];
	const entries = options.entries ?? branch;

	const notifications: string[] = [];
	const notices: Array<{ message: string; kind?: string }> = [];
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, unknown>();
	const widgetCalls: Array<{ key: string; content: unknown }> = [];
	const statusCalls: Array<{ key: string; text: unknown }> = [];
	const toolCalls: Array<{ name: string; args: unknown }> = [];
	const selects: string[][] = [];
	const navigations: string[] = [];
	const editorSets: string[] = [];
	const customCalls: any[] = [];

	let confirmResult = options.confirm;
	let selectResult: DialogResult | DialogResult[] = options.select;
	let editorResult: DialogResult | DialogResult[] = options.editor;
	let customResult = options.custom;
	let executeError = options.executeError ?? false;

	const takeSelect = (): DialogResult => (Array.isArray(selectResult) ? selectResult.shift() : selectResult);
	const takeEditor = (): DialogResult => (Array.isArray(editorResult) ? editorResult.shift() : editorResult);

	const ctx: any = {
		mode,
		hasUI,
		cwd,
		isIdle: options.isIdle ?? (() => true),
		waitForIdle: async () => {},
		navigateTree: async (targetId: string) => {
			navigations.push(targetId);
			return options.navigateTree ? options.navigateTree(targetId) : { cancelled: false };
		},
		sessionManager: {
			getSessionId: () => options.sessionId ?? "s1",
			getLeafId: () => options.leafId,
			getSessionName: () => options.sessionName,
			getCwd: () => cwd,
			getBranch: () => branch,
			getEntries: () => entries,
		},
		tools: [],
		ui: {
			theme: options.theme ?? fakeTheme,
			setStatus: (key: string, text?: string) => {
				statusCalls.push({ key, text });
				if (text === undefined) statuses.delete(key);
				else statuses.set(key, text);
			},
			setWidget: (key: string, content: unknown) => {
				widgetCalls.push({ key, content });
				widgets.set(key, content);
			},
			notify: (message: string, kind?: string) => {
				notifications.push(message);
				notices.push({ message, kind });
			},
			confirm: async () => confirmResult,
			select: async (_title: string, labels: string[] = []) => {
				selects.push(labels);
				return takeSelect();
			},
			editor: async () => takeEditor(),
			input: async () => options.input,
			getEditorText: () => "",
			setEditorText: (text: string) => {
				editorSets.push(text);
			},
			custom: async (factory: any) => {
				customCalls.push(factory);
				return customResult;
			},
		},
		executeTool: async (name: string, args: unknown) => {
			toolCalls.push({ name, args });
			return {
				isError: executeError,
				toolCall: { name, arguments: args },
				result: { content: [], details: undefined },
			};
		},
		// Recorded arrays are exposed on `ctx` for tests that read them directly.
		notices,
		statuses,
		widgets,
		widgetCalls,
		statusCalls,
		navigations,
		editorSets,
		selects,
		customCalls,
	};

	if (options.extra) Object.assign(ctx, options.extra);

	return {
		ctx,
		notifications,
		notices,
		statuses,
		widgets,
		widgetCalls,
		statusCalls,
		toolCalls,
		selects,
		navigations,
		editorSets,
		customCalls,
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
