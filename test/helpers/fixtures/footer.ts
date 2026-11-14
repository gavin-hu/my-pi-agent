/**
 * Fixture for bytefly's footer suite.
 *
 * A context double the footer installs over, the two lines its factory renders,
 * and the snapshot the renderer reads — so a footer test asserts on a frame
 * rather than on a real session. The register harness lives here too: the budget
 * guardrail's suite is the second suite to install a real footer, and a copy of
 * `withRegisteredFooter` in each is the body `test/shared-helpers.test.ts` fails.
 *
 * Value-only: every recorder is created per call.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUBAGENT_FINISHED_CHANNEL } from "../../../lib/events.ts";
import { GLYPHS, STATUS_KEYS } from "../../../lib/tui/glyphs.ts";
import type { PricedUsage, StatusSnapshot } from "../../../extensions/bytefly/footer/types.ts";
import { registerFooter } from "../../../extensions/bytefly/footer/register.ts";
import { withAgentDir } from "../env.ts";
import { emit, fakeTheme, makeFakePi } from "../fakes.ts";

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
	/** Swap the entries and move the leaf, so the next frame prices a different branch. */
	setBranch(entries: unknown[], leafId?: string): void;
}

/** Minimal `ExtensionContext` double for footer install tests. */
export function fakeFooterCtx(options: FooterCtxOptions = {}): FakeFooterCtx {
	const footers: any[] = [];
	const headers: any[] = [];
	const workingMessages: Array<string | undefined> = [];
	const statuses = new Map<string, string>(options.statuses ?? []);
	const cwd = options.cwd ?? "/home/u/repo/project";
	// Mutable, because a session tree is: a case that checks what a settle does after
	// the leaf moved has to be able to move it, and the memo prices on that leaf.
	let entries = options.entries ?? [];
	let leafId = options.leafId ?? "leaf";
	let branches = 0;

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
			getEntries: () => entries,
			getBranch: () => entries,
			getSessionId: () => "sess",
			getLeafId: () => leafId,
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

	const setBranch = (next: unknown[], leaf?: string): void => {
		entries = next;
		leafId = leaf ?? `leaf-${(branches += 1)}`;
	};

	return { ctx, footerData, footers, headers, statuses, workingMessages, setBranch };
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
		teammateName: null,
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

/** Write a config file, creating its directory: the loader reads the same path. */
export function writeConfig(dir: string, name: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify(value));
}

/** An assistant call the footer prices from its own tokens or Pi's recorded amount. */
export function assistantCall(cost: number): unknown {
	return {
		type: "message",
		timestamp: "2026-01-05T03:00:00.000Z",
		message: {
			role: "assistant",
			provider: "anthropic",
			model: "opus-4.5",
			usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: cost } },
		},
	};
}

/** A real footer install: the events Pi emits, and what it posted and rendered. */
export interface FooterHarness {
	pi: any;
	ctx: any;
	footerData: any;
	footers: any[];
	messages: Array<{ message: any }>;
	bodies: string[];
	start(): Promise<void>;
	tree(): Promise<void>;
	settle(): Promise<void>;
	stop(): Promise<void>;
	render(): string[];
	/** Price a different branch: the entries swap and the leaf moves. */
	setBranch(entries: unknown[]): void;
	subagent(event: unknown): void;
}

export interface FooterHarnessOptions {
	cost?: number;
	entries?: unknown[];
	mode?: string;
}

/**
 * Install the shipped footer over a fake Pi, and hand the case what it did.
 *
 * The agent dir is a scratch one per call, because the install reads the config a case
 * writes and the ledger is the extension's own state: a shared directory would let one
 * case's rates price another's spend.
 */
export async function withRegisteredFooter(
	price: Record<string, unknown> | undefined,
	fn: (h: FooterHarness) => Promise<void>,
	options: FooterHarnessOptions = {},
): Promise<void> {
	await withAgentDir(async (agentDir) => {
		if (price) writeConfig(agentDir, "bytefly.json", { price });
		const { pi } = makeFakePi();
		const messages: Array<{ message: any }> = [];
		pi.sendMessage = (message: any) => messages.push({ message });
		const bodies: string[] = [];
		const { ctx, footerData, footers, setBranch } = fakeFooterCtx({
			mode: options.mode ?? "tui",
			entries: options.entries ?? [assistantCall(options.cost ?? 0.6)],
		});

		registerFooter(pi, { notify: (body) => bodies.push(body) });

		await fn({
			pi,
			ctx,
			footerData,
			footers,
			messages,
			bodies,
			start: () => emit(pi, "session_start", { reason: "startup" }, ctx),
			tree: () => emit(pi, "session_tree", {}, ctx),
			settle: () => emit(pi, "agent_settled", { aborted: false }, ctx),
			stop: () => emit(pi, "session_shutdown", { reason: "quit" }, ctx),
			render: () => renderFooter(footers.at(-1), footerData, 100),
			setBranch,
			subagent: (event) => pi.events.emit(SUBAGENT_FINISHED_CHANNEL, event),
		});
	}, "bytefly-footer-agent-");
}

/** `price` configured for dollars with the given budget. */
export const usdBudget = (budget: number): Record<string, unknown> => ({ currency: { code: "USD" }, budget });
