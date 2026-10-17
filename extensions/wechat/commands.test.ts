import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { remoteCtx } from "../../test/helpers/remote-ui.ts";
import type { Bridge, BridgeStatus } from "./bridge.ts";
import { finishLogin, registerCommands, runNew, WECHAT_COMMANDS, WECHAT_USAGE, type CommandDeps } from "./commands.ts";
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
		refusedPeers: [],
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
	/** Bridge lifecycle calls in order, so a restart is asserted as one sequence. */
	events: string[];
}

function harness(options: { open?: () => void; status?: BridgeStatus; bridge?: boolean } = {}): Harness {
	const saved: BotCredentials[] = [];
	const events: string[] = [];
	let ensured = 0;
	let logouts = 0;
	const status = options.status ?? bridgeStatus();
	const bridge = {
		open: () => {
			events.push("open");
			options.open?.();
		},
		close: async () => {
			events.push("close");
		},
		status: () => status,
	} as unknown as Bridge;
	const exists = options.bridge ?? true;
	return {
		deps: {
			getBridge: () => (exists ? bridge : undefined),
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
		opens: () => events.filter((event) => event === "open").length,
		ensured: () => ensured,
		logouts: () => logouts,
		events,
	};
}

describe("finishLogin", () => {
	test("stores the account and starts the bridge on a confirmed scan", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "confirmed", account }, ctx, deps);
		expect(saved).toEqual([account]);
		expect(opens()).toBe(1);
		expect(notices.at(-1)?.message).toContain("running");
	});

	test("stops a running poller before opening with the new credentials", async () => {
		const { deps, events } = harness({ status: bridgeStatus({ open: true }) });
		const { ctx } = fakeCtx();
		await finishLogin({ kind: "confirmed", account }, ctx, deps);
		// `open()` is a no-op while a bridge runs, so a scan has to close it first.
		expect(events).toEqual(["close", "open"]);
	});

	test("keeps the account and points at status when connecting fails", async () => {
		const { deps, saved, opens } = harness({
			open: () => {
				throw new Error("Another Pi session is already polling this WeChat account.");
			},
		});
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "confirmed", account }, ctx, deps);
		expect(saved).toEqual([account]);
		expect(opens()).toBe(1);
		const last = notices.at(-1);
		expect(last?.kind).toBe("warning");
		expect(last?.message).toContain("did not start");
		expect(last?.message).toContain("/wechat status");
	});

	test("reports an expired QR without touching credentials or the bridge", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "expired" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("expired");
	});

	test("reports a login error without connecting", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "error", message: "boom" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)).toEqual({ message: "WeChat login failed: boom", kind: "error" });
	});

	test("stays silent on cancel", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "cancelled" }, ctx, deps);
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

	test("declines while a WeChat turn owns the session", async () => {
		let started = 0;
		const { ctx, notices } = remoteCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await runNew(ctx);
		// Replacing the session here would drop the turn and silence the peer.
		expect(started).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat new");
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

	test("lists every verb with a description on help", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx();
		await handler(deps)("help", ctx);
		const help = notices.at(-1)?.message ?? "";
		// The usage line, then one described line per verb.
		expect(help.split("\n")[0]).toBe(`wechat commands — ${WECHAT_USAGE}`);
		for (const command of WECHAT_COMMANDS) {
			expect(help).toContain(`/wechat ${command.verb} — ${command.description}`);
		}
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

	test("completes each verb with the description help shows", () => {
		const fake = createFakePi();
		registerCommands(fake.pi, harness().deps);
		const complete = fake.commands.get("wechat")?.getArgumentCompletions;
		if (!complete) throw new Error("completions not registered");
		const items = complete("lo");
		expect(items).toEqual([
			{ value: "login", label: "login", description: expect.stringContaining("QR") },
			{ value: "logout", label: "logout", description: expect.stringContaining("account") },
		]);
		expect(complete("login ")).toBeNull();
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

	test("declines new instead of replacing the session under the turn", async () => {
		let started = 0;
		const { deps } = harness();
		const { ctx, notices } = remoteCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await handler(deps)("new", ctx);
		expect(started).toBe(0);
		expect(notices.at(-1)?.message).toContain("/wechat new");
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
