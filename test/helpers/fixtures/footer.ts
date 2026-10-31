/**
 * Fixture for bytefly's footer suite.
 *
 * A context double the footer installs over, the two lines its factory renders,
 * and the snapshot the renderer reads — so a footer test asserts on a frame
 * rather than on a real session.
 *
 * Value-only: every recorder is created per call.
 */

import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import type { PricedUsage, StatusSnapshot } from "../../../extensions/bytefly/footer/types.ts";
import { fakeTheme } from "../fakes.ts";

interface FooterCtxOptions {
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

interface FakeFooterCtx {
	ctx: any;
	footerData: any;
	footers: any[];
	headers: any[];
	statuses: Map<string, string>;
	/** Messages passed to `ui.setWorkingMessage`, in order. */
	workingMessages: Array<string | undefined>;
}

/** Minimal `ExtensionContext` double for footer install tests. */
export function fakeFooterCtx(options: FooterCtxOptions = {}): FakeFooterCtx {
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

/**
 * The session totals a snapshot carries: zeroed, with what the pricer adds.
 *
 * A case that only cares about one number overrides it and gets the rest for free —
 * `unpriced` and `unpricedModels` are part of the shape, not an optional extra.
 */
export function usageOf(overrides: Partial<PricedUsage> = {}): PricedUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0, unpricedModels: [], ...overrides };
}

/** A snapshot with every field populated. */
export function fullSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
	return {
		cwd: "/home/u/repo/project",
		sessionName: null,
		rosterLabel: null,
		branch: "main",
		statuses: new Map([
			[STATUS_KEYS.planMode, `${GLYPHS.plan} plan`],
			[STATUS_KEYS.worktree, `${GLYPHS.worktree} smoke`],
		]),
		model: { id: "opus-4.5", provider: "anthropic", reasoning: true },
		thinkingLevel: "high",
		context: { tokens: 124000, contextWindow: 200000, percent: 62 },
		usage: usageOf({ input: 42000, output: 8000, cacheRead: 96000, cost: 0.31 }),
		currency: { code: "USD", decimals: 2 },
		budget: 0,
		cacheHitRate: 87,
		providerCount: 1,
		delegation: { runs: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } },
		...overrides,
	};
}
