import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";
import type { Bridge, BridgeStatus } from "./bridge.ts";
import { finishLogin, registerCommands, runNew, WECHAT_USAGE, type CommandDeps } from "./commands.ts";
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
	logouts: () => number;
}

function harness(options: { open?: () => void; status?: BridgeStatus } = {}): Harness {
	const saved: BotCredentials[] = [];
	let opens = 0;
	let ensured = 0;
	let logouts = 0;
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
			logout: () => {
				logouts += 1;
			},
			now: () => 0,
		},
		saved,
		opens: () => opens,
		ensured: () => ensured,
		logouts: () => logouts,
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

	test("keeps the account and points at status when connecting fails", () => {
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
		expect(last?.message).toContain("/wechat status");
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

describe("the /wechat command", () => {
	function handler(deps: CommandDeps) {
		const fake = createFakePi();
		registerCommands(fake.pi, deps);
		const registered = fake.commands.get("wechat")?.handler;
		if (!registered) throw new Error("command not registered");
		return registered;
	}

	test("warns on an unknown subcommand instead of silently showing status", async () => {
		const { deps } = harness();
		const { ctx, notices, customCalls } = fakeCtx({ custom: "close" });
		await handler(deps)("start", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain('Unknown wechat command "start"');
		expect(notices.at(-1)?.message).toContain("/wechat login");
		expect(customCalls).toEqual([]);
	});

	test("lists the commands on help", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx();
		await handler(deps)("help", ctx);
		expect(notices.at(-1)?.message).toBe(`wechat commands — ${WECHAT_USAGE}`);
	});

	test("opens the control screen for a bare command and runs the chosen action", async () => {
		const started: number[] = [];
		const { deps } = harness();
		const { ctx, customCalls } = fakeCtx({
			custom: "new",
			extra: {
				newSession: async () => {
					started.push(1);
					return { cancelled: false };
				},
			},
		});
		await handler(deps)("", ctx);
		expect(customCalls.length).toBe(1);
		expect(started).toEqual([1]);
	});

	test("closes without dispatching when the control screen closes", async () => {
		const { deps } = harness();
		const { ctx, customCalls, notices } = fakeCtx({ custom: "close" });
		await handler(deps)("status", ctx);
		expect(customCalls.length).toBe(1);
		expect(notices).toEqual([]);
	});
});

/**
 * While a WeChat turn owns the dialogs, `ctx.ui.custom` resolves `undefined` and
 * the dialog routes to WeChat, so a terminal-side command must decline instead
 * of opening a screen on the phone or reading back nothing.
 */
describe("the /wechat command during a WeChat turn", () => {
	function handler(deps: CommandDeps) {
		const fake = createFakePi();
		registerCommands(fake.pi, deps);
		const registered = fake.commands.get("wechat")?.handler;
		if (!registered) throw new Error("command not registered");
		return registered;
	}

	test("prints the one-line summary instead of opening the control screen", async () => {
		const { deps } = harness();
		const { ctx, notifications, customCalls } = remoteCtx();
		await handler(deps)("status", ctx);
		expect(customCalls).toEqual([]);
		expect(notifications.at(-1)).toContain("wechat:");
	});

	test("declines logout before asking for a confirmation", async () => {
		const { deps, logouts } = harness();
		const { ctx, notices, confirms } = remoteCtx();
		await handler(deps)("logout", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat logout");
		expect(confirms).toEqual([]);
		expect(logouts()).toBe(0);
	});

	test("declines login before fetching a QR code", async () => {
		const { deps } = harness();
		const { ctx, notices } = remoteCtx();
		// The harness login client throws, so reaching it would fail this test.
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat login");
	});
});
