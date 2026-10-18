import type { MarkdownTransformer, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import type { StatusSnapshot } from "../../../extensions/bytefly/footer/types.ts";
import { createFakePi, fakeTheme, type AnyHandler } from "../fakes.ts";

export { emit, fakeTheme } from "../fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	renderers: Map<string, any>;
	messageRenderers: Map<string, any>;
	toolRenderers: ToolRendererResolver[];
	markdownTransformers: MarkdownTransformer[];
	appended: Array<{ customType: string; data?: unknown }>;
}

/** Minimal `ExtensionAPI` double covering what the bytefly extension uses. */
export function makeFakePi(options: { settings?: any } = {}): FakePi {
	const fake = createFakePi({ settings: options.settings });
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		handlers: fake.handlers,
		renderers: fake.renderers,
		messageRenderers: fake.messageRenderers,
		toolRenderers: fake.toolRenderers,
		markdownTransformers: fake.markdownTransformers,
		appended: fake.appended,
	};
}

export interface FakeCtxOptions {
	mode?: string;
	cwd?: string;
	home?: string;
	branch?: string | null;
	entries?: unknown[];
	statuses?: Array<[string, string]>;
	model?: any;
	thinkingLevel?: string | null;
	sessionName?: string;
	context?: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	providerCount?: number;
	leafId?: string;
	/** Whether the project is trusted; the panel command reads it. */
	trusted?: boolean;
}

export interface FakeFooterCtx {
	ctx: any;
	footerData: any;
	footers: any[];
	headers: any[];
	statuses: Map<string, string>;
	/** Messages passed to `ui.setWorkingMessage`, in order. */
	workingMessages: Array<string | undefined>;
}

/** Minimal `ExtensionContext` double for footer install tests. */
export function fakeFooterCtx(options: FakeCtxOptions = {}): FakeFooterCtx {
	const footers: any[] = [];
	const headers: any[] = [];
	const workingMessages: Array<string | undefined> = [];
	const statuses = new Map<string, string>(options.statuses ?? []);
	const cwd = options.cwd ?? "/home/u/repo/project";

	const footerData = {
		getGitBranch: () => (options.branch === undefined ? "main" : options.branch),
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => options.providerCount ?? 1,
		onBranchChange: () => () => {},
	};

	const ctx: any = {
		mode: options.mode ?? "tui",
		cwd,
		isProjectTrusted: () => options.trusted ?? true,
		model:
			options.model === undefined
				? { id: "opus-4.5", provider: "anthropic", contextWindow: 200000, reasoning: true }
				: options.model,
		thinkingLevel: options.thinkingLevel === undefined ? "high" : options.thinkingLevel,
		getContextUsage: () => options.context,
		sessionManager: {
			getEntries: () => options.entries ?? [],
			getBranch: () => options.entries ?? [],
			getSessionId: () => "sess",
			getLeafId: () => options.leafId ?? "leaf",
			getSessionName: () => options.sessionName,
			getCwd: () => cwd,
		},
		ui: {
			theme: fakeTheme,
			setFooter: (factory: any) => footers.push(factory),
			setHeader: (factory: any) => headers.push(factory),
			setWorkingMessage: (message?: string) => workingMessages.push(message),
			notify: () => {},
		},
	};

	return { ctx, footerData, footers, headers, statuses, workingMessages };
}

/** Render a footer factory into its two lines. */
export function renderFooter(factory: any, footerData: any, width = 100): string[] {
	const component = factory({ requestRender: () => {} }, fakeTheme, footerData);
	return component.render(width);
}

/** A separator entry as the store would return it. */
export function separatorEntry(turn: number): unknown {
	return { type: "custom", customType: "bytefly-separator", data: { turn } };
}

/** A snapshot with every field populated. */
export function fullSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
	return {
		cwd: "/home/u/repo/project",
		sessionName: null,
		branch: "main",
		statuses: new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
		]),
		model: { id: "opus-4.5", provider: "anthropic", reasoning: true },
		thinkingLevel: "high",
		context: { tokens: 124000, contextWindow: 200000, percent: 62 },
		usage: { input: 42000, output: 8000, cacheRead: 96000, cacheWrite: 0, cost: 0.31 },
		currency: { code: "USD", decimals: 2 },
		cacheHitRate: 87,
		providerCount: 1,
		delegation: { runs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } },
		...overrides,
	};
}
