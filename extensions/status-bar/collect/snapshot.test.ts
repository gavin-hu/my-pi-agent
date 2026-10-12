import { describe, expect, test } from "bun:test";
import { DEFAULT_STATUS_BAR_CONFIG } from "../config.ts";
import type { StatusBarConfig } from "../types.ts";
import { createSnapshotReader } from "./snapshot.ts";

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

const priced = (overrides: Partial<StatusBarConfig> = {}): StatusBarConfig => ({
	...DEFAULT_STATUS_BAR_CONFIG,
	currency: { symbol: "¥", decimals: 2 },
	rates: { "anthropic/opus-4.5": { input: 2.5, output: 0, cacheRead: 0, cacheWrite: 0, offPeakMultiplier: 1 } },
	...overrides,
});

describe("createSnapshotReader", () => {
	test("builds a full snapshot", () => {
		const read = createSnapshotReader(DEFAULT_STATUS_BAR_CONFIG);
		const snapshot = read(makeCtx(), footerData);

		expect(snapshot.cwd).toBe("/home/u/repo/project");
		expect(snapshot.sessionName).toBe("my-session");
		expect(snapshot.branch).toBe("main");
		expect(snapshot.statuses.get("worktree")).toBe("⑂ smoke");
		expect(snapshot.model).toEqual({ id: "opus-4.5", provider: "anthropic", reasoning: true });
		expect(snapshot.thinkingLevel).toBe("high");
		expect(snapshot.context).toEqual({ tokens: 124000, contextWindow: 200000, percent: 62 });
		expect(snapshot.usage.cost).toBeCloseTo(0.01);
		expect(snapshot.currency).toEqual({ symbol: "$", decimals: 2 });
		expect(snapshot.cacheHitRate).toBeCloseTo(50);
		expect(snapshot.providerCount).toBe(2);
	});

	test("falls back to the model context window when usage is unknown", () => {
		const read = createSnapshotReader(DEFAULT_STATUS_BAR_CONFIG);
		const snapshot = read(makeCtx({ getContextUsage: () => undefined }), footerData);

		expect(snapshot.context).toEqual({ tokens: null, contextWindow: 200000, percent: null });
	});

	test("reports no model", () => {
		const read = createSnapshotReader(DEFAULT_STATUS_BAR_CONFIG);
		const snapshot = read(makeCtx({ model: undefined, getContextUsage: () => undefined }), footerData);

		expect(snapshot.model).toBeNull();
		expect(snapshot.context.contextWindow).toBe(0);
	});

	test("keeps Pi's recorded cost when no rate matches", () => {
		const read = createSnapshotReader(DEFAULT_STATUS_BAR_CONFIG);

		expect(read(makeCtx(), footerData).usage.cost).toBeCloseTo(0.01);
	});

	test("prices from a configured rate and carries its currency", () => {
		const read = createSnapshotReader(priced());
		const snapshot = read(millionTokens(), footerData);

		expect(snapshot.usage.cost).toBeCloseTo(2.5);
		expect(snapshot.currency).toEqual({ symbol: "¥", decimals: 2 });
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
		const read = createSnapshotReader(DEFAULT_STATUS_BAR_CONFIG);

		read(ctx, footerData);
		read(ctx, footerData);
		expect(reads).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(reads).toBe(2);
	});
});
