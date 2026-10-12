import { describe, expect, test } from "bun:test";
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

describe("createSnapshotReader", () => {
	test("builds a full snapshot", () => {
		const read = createSnapshotReader();
		const snapshot = read(makeCtx(), footerData);

		expect(snapshot.cwd).toBe("/home/u/repo/project");
		expect(snapshot.sessionName).toBe("my-session");
		expect(snapshot.branch).toBe("main");
		expect(snapshot.statuses.get("worktree")).toBe("⑂ smoke");
		expect(snapshot.model).toEqual({ id: "opus-4.5", provider: "anthropic", reasoning: true });
		expect(snapshot.thinkingLevel).toBe("high");
		expect(snapshot.context).toEqual({ tokens: 124000, contextWindow: 200000, percent: 62 });
		expect(snapshot.usage.cost).toBeCloseTo(0.01);
		expect(snapshot.cacheHitRate).toBeCloseTo(50);
		expect(snapshot.providerCount).toBe(2);
	});

	test("falls back to the model context window when usage is unknown", () => {
		const read = createSnapshotReader();
		const snapshot = read(makeCtx({ getContextUsage: () => undefined }), footerData);

		expect(snapshot.context).toEqual({ tokens: null, contextWindow: 200000, percent: null });
	});

	test("reports no model", () => {
		const read = createSnapshotReader();
		const snapshot = read(makeCtx({ model: undefined, getContextUsage: () => undefined }), footerData);

		expect(snapshot.model).toBeNull();
		expect(snapshot.context.contextWindow).toBe(0);
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
		const read = createSnapshotReader();

		read(ctx, footerData);
		read(ctx, footerData);
		expect(reads).toBe(1);

		ctx.sessionManager.getLeafId = () => "leaf-2";
		read(ctx, footerData);
		expect(reads).toBe(2);
	});
});
