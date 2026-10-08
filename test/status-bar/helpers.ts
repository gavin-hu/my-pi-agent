import { GLYPHS, STATUS_KEYS } from "../../extensions/_shared/ui.ts";
import type { StatusSnapshot } from "../../extensions/status-bar/types.ts";
import { createFakePi, fakeTheme, type AnyHandler } from "../helpers/fakes.ts";

export { emit, fakeTheme } from "../helpers/fakes.ts";
export type { AnyHandler };

export interface FakePi {
	pi: any;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
}

/** Minimal `ExtensionAPI` double covering what the status-bar extension uses. */
export function makeFakePi(options: { settings?: any } = {}): FakePi {
	const fake = createFakePi({ settings: options.settings });
	return { pi: fake.pi, commands: fake.commands, handlers: fake.handlers };
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
	context?: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	providerCount?: number;
	leafId?: string;
}

export interface FakeFooterCtx {
	ctx: any;
	footerData: any;
	footers: any[];
	notifications: string[];
	statuses: Map<string, string>;
}

/** Minimal `ExtensionContext` double for footer install/restore tests. */
export function fakeFooterCtx(options: FakeCtxOptions = {}): FakeFooterCtx {
	const footers: any[] = [];
	const notifications: string[] = [];
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
			getSessionName: () => undefined,
			getCwd: () => cwd,
		},
		ui: {
			theme: fakeTheme,
			setFooter: (factory: any) => footers.push(factory),
			notify: (message: string) => notifications.push(message),
		},
	};

	return { ctx, footerData, footers, notifications, statuses };
}

/** Render a footer factory into its two lines. */
export function renderFooter(factory: any, footerData: any, width = 100): string[] {
	const component = factory({ requestRender: () => {} }, fakeTheme, footerData);
	return component.render(width);
}

/** A snapshot with every field populated. */
export function fullSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
	return {
		cwd: "/home/u/repo/project",
		branch: "main",
		statuses: new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
		]),
		model: { id: "opus-4.5", provider: "anthropic", reasoning: true },
		thinkingLevel: "high",
		context: { tokens: 124000, contextWindow: 200000, percent: 62 },
		usage: { input: 42000, output: 8000, cacheRead: 96000, cacheWrite: 0, cost: 0.31 },
		cacheHitRate: 87,
		providerCount: 1,
		...overrides,
	};
}
