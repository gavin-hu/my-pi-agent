import { describe, expect, test } from "bun:test";
import { DEFAULT_BYTEFLY_CONFIG } from "../price/config.ts";
import type { ByteflyConfig } from "../price/types.ts";
import { createDelegationLedger } from "../delegation.ts";
import { createSnapshotReader } from "./snapshot.ts";

/** A fresh, empty child-run ledger for each reader a test builds. */
const noDelegation = () => createDelegationLedger();

const assistant = (usage: any) => ({ type: "message", message: { role: "assistant", usage } });

const u = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: { total },
});

function makeCtx(overrides: any = {}): any {
	return {
		cwd: "/home/u/repo/project",
		model: { id: "opus-4.5", provider: "anthropic", contextWindow: 200000, reasoning: true },
		thinkingLevel: "high",
		getContextUsage: () => ({ tokens: 124000, contextWindow: 200000, percent: 62 }),
		sessionManager: {
			getSessionId: () => "sess",
			getLeafId: () => "leaf",
			getSessionName: () => "my-session",
			getEntries: () => [assistant(u(100, 50, 100, 0, 0.01))],
		},
		...overrides,
	};
}

const footerData: any = {
	getGitBranch: () => "main",
	getExtensionStatuses: () => new Map([["worktree", "⑂ smoke"]]),
	getAvailableProviderCount: () => 2,
	onBranchChange: () => () => {},
};

/** A million-token Opus call, so a configured rate lands on a round number. */
const millionTokens = (): any =>
	makeCtx({
		sessionManager: {
			getSessionId: () => "sess",
			getLeafId: () => "leaf",
			getSessionName: () => "my-session",
			getEntries: () => [assistant(u(1_000_000, 0, 0, 0, 0))],
		},
	});

const priced = (overrides: Partial<ByteflyConfig> = {}): ByteflyConfig => ({
	...DEFAULT_BYTEFLY_CONFIG,
	currency: { code: "CNY", decimals: 2 },
	rates: { "anthropic/opus-4.5": { input: 2.5, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 } },
	...overrides,
});

describe("createSnapshotReader", () => {
	test("builds a full snapshot", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		const snapshot = read(makeCtx(), footerData);

		expect(snapshot.cwd).toBe("/home/u/repo/project");
		expect(snapshot.sessionName).toBe("my-session");
		expect(snapshot.branch).toBe("main");
		expect(snapshot.statuses.get("worktree")).toBe("⑂ smoke");
		expect(snapshot.model).toEqual({ id: "opus-4.5", provider: "anthropic", reasoning: true });
		expect(snapshot.thinkingLevel).toBe("high");
		expect(snapshot.context).toEqual({ tokens: 124000, contextWindow: 200000, percent: 62 });
		expect(snapshot.usage.cost).toBe(0);
		expect(snapshot.currency).toEqual({ code: "CNY", decimals: 2 });
		expect(snapshot.cacheHitRate).toBeCloseTo(50);
		expect(snapshot.providerCount).toBe(2);
	});

	test("falls back to the model context window when usage is unknown", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		const snapshot = read(makeCtx({ getContextUsage: () => undefined }), footerData);

		expect(snapshot.context).toEqual({ tokens: null, contextWindow: 200000, percent: null });
	});

	test("reports no model", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());
		const snapshot = read(makeCtx({ model: undefined, getContextUsage: () => undefined }), footerData);

		expect(snapshot.model).toBeNull();
		expect(snapshot.context.contextWindow).toBe(0);
	});

	test("leaves a model with no matching rate out of the total", () => {
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());

		expect(read(makeCtx(), footerData).usage.cost).toBe(0);
	});

	test("prices from a configured rate and carries its currency", () => {
		const read = createSnapshotReader(priced(), noDelegation());
		const snapshot = read(millionTokens(), footerData);

		expect(snapshot.usage.cost).toBeCloseTo(2.5);
		expect(snapshot.currency).toEqual({ code: "CNY", decimals: 2 });
	});

	test("memoizes the usage scan until the branch leaf moves", () => {
		let reads = 0;
		const ctx = makeCtx({
			sessionManager: {
				getSessionId: () => "sess",
				getLeafId: () => "leaf-1",
				getSessionName: () => "my-session",
				getEntries: () => {
					reads++;
					return [assistant(u(100, 50, 0, 0, 0.5))];
				},
			},
		});
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());

		read(ctx, footerData);
		read(ctx, footerData);
		expect(reads).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(reads).toBe(2);
	});

	test("memoizes the context estimate until the leaf or the model moves", () => {
		let estimates = 0;
		const ctx = makeCtx({
			getContextUsage: () => {
				estimates++;
				return { tokens: 124000, contextWindow: 200000, percent: 62 };
			},
		});
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, noDelegation());

		read(ctx, footerData);
		read(ctx, footerData);
		expect(estimates).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(estimates).toBe(2);

		ctx.model = { ...ctx.model, id: "sonnet-4.5" };
		read(ctx, footerData);
		expect(estimates).toBe(3);
	});

	test("prices child runs separately and leaves the session total alone", () => {
		const ledger = createDelegationLedger();
		ledger.note({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1_000_000,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0,
			at: null,
			exitCode: 0,
		});
		const read = createSnapshotReader(priced(), ledger);

		const snapshot = read(millionTokens(), footerData);

		// The parent call and the child run are both one Opus million, at 2.5/M.
		expect(snapshot.usage.cost).toBeCloseTo(2.5);
		expect(snapshot.delegation).toEqual({
			runs: 1,
			usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 2.5 },
		});
	});

	test("re-prices the roll-up when a new child run lands", () => {
		const ledger = createDelegationLedger();
		const read = createSnapshotReader(priced(), ledger);
		const ctx = millionTokens();
		expect(read(ctx, footerData).delegation.runs).toBe(0);

		ledger.note({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1_000_000,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0,
			at: null,
			exitCode: 0,
		});
		const after = read(ctx, footerData);

		expect(after.delegation.runs).toBe(1);
		expect(after.delegation.usage.cost).toBeCloseTo(2.5);
		// The parent scan still ran once; the ledger version, not the branch, moved.
		expect(after.usage.cost).toBeCloseTo(2.5);
	});

	test("a USD reader prices the child's recorded dollars", () => {
		const ledger = createDelegationLedger();
		ledger.note({
			agent: "explorer",
			provider: "other",
			model: "unpriced",
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			recordedCost: 0.4,
			at: null,
			exitCode: 0,
		});
		const read = createSnapshotReader(priced({ currency: { code: "USD", decimals: 2 }, rates: {} }), ledger);

		expect(read(makeCtx(), footerData).delegation.usage.cost).toBeCloseTo(0.4);
	});
});
