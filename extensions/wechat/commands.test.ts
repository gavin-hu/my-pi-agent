import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import type { Bridge, BridgeStatus } from "./bridge.ts";
import { finishLogin, runNew, type CommandDeps } from "./commands.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { BotCredentials } from "./types.ts";

const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function bridgeStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		open: false,
		expired: false,
		peerCount: 0,
		queued: 0,
		refused: 0,
		mediaDropped: 0,
		promptPending: false,
		...overrides,
	};
}

interface Harness {
	deps: CommandDeps;
	saved: BotCredentials[];
	opens: () => number;
	ensured: () => number;
}

function harness(options: { open?: () => void; status?: BridgeStatus } = {}): Harness {
	const saved: BotCredentials[] = [];
	let opens = 0;
	let ensured = 0;
	const status = options.status ?? bridgeStatus();
	const bridge = {
		open: () => {
			opens += 1;
			options.open?.();
		},
		status: () => status,
	} as unknown as Bridge;
	return {
		deps: {
			getBridge: () => bridge,
			ensureBridge: () => {
				ensured += 1;
				return bridge;
			},
			loadConfig: () => DEFAULT_CONFIG,
			createLoginClient: () => {
				throw new Error("login client is not used by these commands");
			},
			saveAccount: (value) => saved.push(value),
			primaryAccount: () => undefined,
			logout: () => {},
			now: () => 0,
		},
		saved,
		opens: () => opens,
		ensured: () => ensured,
	};
}

describe("finishLogin", () => {
	test("stores the account and starts the bridge on a confirmed scan", () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		finishLogin({ kind: "confirmed", account }, ctx, deps);
		expect(saved).toEqual([account]);
		expect(opens()).toBe(1);
		expect(notices.at(-1)?.message).toContain("running");
	});

	test("keeps the account and tells the user to start manually when connecting fails", () => {
		const { deps, saved, opens } = harness({
			open: () => {
				throw new Error("Another Pi session is already polling this WeChat account.");
			},
		});
		const { ctx, notices } = fakeCtx();
		finishLogin({ kind: "confirmed", account }, ctx, deps);
		expect(saved).toEqual([account]);
		expect(opens()).toBe(1);
		const last = notices.at(-1);
		expect(last?.kind).toBe("warning");
		expect(last?.message).toContain("did not start");
		expect(last?.message).toContain("/wechat start");
	});

	test("reports an expired QR without touching credentials or the bridge", () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		finishLogin({ kind: "expired" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("expired");
	});

	test("reports a login error without connecting", () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		finishLogin({ kind: "error", message: "boom" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)).toEqual({ message: "WeChat login failed: boom", kind: "error" });
	});

	test("stays silent on cancel", () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		finishLogin({ kind: "cancelled" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices).toEqual([]);
	});
});

describe("runNew", () => {
	test("starts a new session through the command context", async () => {
		let started = 0;
		const { ctx } = fakeCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await runNew(ctx);
		expect(started).toBe(1);
	});
});
