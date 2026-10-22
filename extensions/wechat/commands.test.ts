/**
 * The operator command surface and the peer-facing conversation pieces: the
 * `/wechat` verb table, its dialogs and login/logout handling, the inbound slash
 * commands, the notice catalog, prompt rendering and parsing, the interaction
 * channel, and the peer session's UI context.
 *
 * The bridge, the client, and the terminal context are doubles, so this suite
 * proves the wiring and the reply rules without a network, a session, or a real
 * timer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import {
	askHuman,
	type InteractionAnswer,
	type InteractionChannel,
	type InteractionRequest,
	INTERACTION_OTHER_LABEL,
	isRemoteTurn,
	remoteChannel,
} from "../../lib/interaction.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import type { Bridge, BridgeStatus } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import { finishLogin, registerCommands, runNew, WECHAT_COMMANDS, WECHAT_USAGE, type CommandDeps } from "./commands.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { PeerLanguage } from "./format.ts";
import { createWechatInteractionChannel, PROMPT_TIMEOUT_MS, type WechatInteractionDeps } from "./interaction.ts";
import { notice, type NoticeKind } from "./notices.ts";
import { formatPrompt, parsePromptAnswer, RETRY_NOTICE } from "./prompt.ts";
import { createPeerUIContext } from "./remote-ui.ts";
import {
	expandSnippet,
	findSlashCommand,
	helpText,
	parseSlash,
	SLASH_COMMANDS,
	type SlashCommand,
	type SlashContext,
	type SlashPeerState,
} from "./slash.ts";
import type { ArmTimer } from "./timer.ts";
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
		paused: false,
		running: false,
		peerCount: 0,
		queued: 0,
		peerStates: [],
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
	/** Bridge lifecycle calls in order, so a restart is asserted as one sequence. */
	events: string[];
	/** Peers passed to `bridge.stop` / `bridge.reset`, in order. */
	stops: string[];
	resets: string[];
	logouts: () => number;
}

function harness(
	options: {
		open?: () => void;
		status?: BridgeStatus;
		bridge?: boolean;
		stop?: boolean;
		reset?: boolean;
		pause?: boolean;
		resume?: boolean;
	} = {},
): Harness {
	const saved: BotCredentials[] = [];
	const events: string[] = [];
	const stops: string[] = [];
	const resets: string[] = [];
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
		stop: (peer: string) => {
			stops.push(peer);
			return options.stop ?? true;
		},
		reset: (peer: string) => {
			resets.push(peer);
			return options.reset ?? true;
		},
		pause: async () => {
			events.push("pause");
			return options.pause ?? true;
		},
		resume: async () => {
			events.push("resume");
			return options.resume ?? true;
		},
	} as unknown as Bridge;
	const exists = options.bridge ?? true;
	return {
		deps: {
			getBridge: () => (exists ? bridge : undefined),
			ensureBridge: () => bridge,
			loadConfig: () => DEFAULT_CONFIG,
			createLoginClient: () => {
				throw new Error("login client is not used by these commands");
			},
			saveAccount: (value) => saved.push(value),
			primaryAccount: () => undefined,
			readHistory: async () => "",
			logout: () => {
				logouts += 1;
			},
			now: () => 0,
		},
		saved,
		opens: () => events.filter((event) => event === "open").length,
		events,
		stops,
		resets,
		logouts: () => logouts,
	};
}

function handler(deps: CommandDeps) {
	const fake = createFakePi();
	registerCommands(fake.pi, deps);
	const registered = fake.commands.get("wechat")?.handler;
	if (!registered) throw new Error("command not registered");
	return registered;
}

describe("the /wechat verb table", () => {
	test("completes every verb, with the description help shows", () => {
		const fake = createFakePi();
		registerCommands(fake.pi, harness().deps);
		const complete = fake.commands.get("wechat")?.getArgumentCompletions;
		if (!complete) throw new Error("completions not registered");
		const items = complete("") ?? [];
		expect(items.map((item: { label: string }) => item.label)).toEqual(WECHAT_COMMANDS.map((command) => command.verb));
		for (const item of items) {
			const command = WECHAT_COMMANDS.find((entry) => entry.verb === item.label);
			expect(item.description).toBe(command?.description);
		}
		expect(complete("lo")).toEqual([
			{ value: "login", label: "login", description: expect.stringContaining("QR") },
			{ value: "logout", label: "logout", description: expect.stringContaining("account") },
		]);
		expect(complete("login ")).toBeNull();
	});

	test("help lists the usage line and every verb with its description", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx();
		await handler(deps)("help", ctx);
		const help = notices.at(-1)?.message ?? "";
		expect(help.split("\n")[0]).toBe(`wechat commands — ${WECHAT_USAGE}`);
		for (const command of WECHAT_COMMANDS) {
			expect(help).toContain(`/wechat ${command.verb} — ${command.description}`);
		}
	});

	test("warns on an unknown subcommand instead of silently showing status", async () => {
		const { deps } = harness();
		const { ctx, notices, customCalls } = fakeCtx({ custom: "close" });
		await handler(deps)("start", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain('Unknown wechat command "start"');
		expect(notices.at(-1)?.message).toContain("/wechat login");
		expect(customCalls).toEqual([]);
	});
});

describe("the control screen", () => {
	test("opens for a bare command and runs the chosen action", async () => {
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

	test("closes without dispatching when the screen closes", async () => {
		const { deps } = harness();
		const { ctx, customCalls, notices } = fakeCtx({ custom: "close" });
		await handler(deps)("status", ctx);
		expect(customCalls.length).toBe(1);
		expect(notices).toEqual([]);
	});

	test("routes the screen's history and allow actions through the command", async () => {
		const dir = tempDir("wechat-allow-");
		const h = harness({ status: bridgeStatus({ refused: 1, refusedPeers: ["alice"] }) });
		h.deps.readHistory = async (peer, count) => `${peer} ${count}`;
		const history = fakeCtx({ custom: { kind: "history", peer: "alice" } });
		await handler(h.deps)("status", history.ctx);
		expect(history.notices.at(-1)?.message).toContain("alice");

		const allow = fakeCtx({ cwd: dir, custom: { kind: "allow" }, select: "alice", confirm: true });
		await handler(h.deps)("status", allow.ctx);
		expect(JSON.parse(readFileSync(join(dir, CONFIG_DIR_NAME, "bytefly.json"), "utf8")).wechat.allowedPeers).toEqual([
			"alice",
		]);
	});
});

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

describe("/wechat login", () => {
	test("declines outside the TUI, where the QR screen has nothing to draw on", async () => {
		const { deps } = harness();
		const { ctx, notices, customCalls } = fakeCtx({ mode: "rpc" });
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("interactive terminal UI");
		expect(customCalls).toEqual([]);
	});

	test("reports a QR fetch failure without opening the screen", async () => {
		const { deps } = harness();
		deps.createLoginClient = () =>
			({
				fetchQr: async () => {
					throw new Error("ilink down");
				},
			}) as unknown as WechatClient;
		const { ctx, notices, customCalls } = fakeCtx();
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("error");
		expect(notices.at(-1)?.message).toContain("ilink down");
		expect(customCalls).toEqual([]);
	});

	test("stores the scanned account and connects", async () => {
		const { deps, saved, opens } = harness();
		deps.createLoginClient = () =>
			({
				fetchQr: async () => ({ qrcode: "Q", imgContent: "url" }),
			}) as unknown as WechatClient;
		const { ctx, notices, customCalls } = fakeCtx({ custom: { kind: "confirmed", account } });
		await handler(deps)("login", ctx);
		expect(customCalls.length).toBe(1);
		expect(saved).toEqual([account]);
		expect(opens()).toBe(1);
		expect(notices.at(-1)?.message).toContain("owner");
	});
});

describe("/wechat new", () => {
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
		await runNew(ctx, harness().deps);
		expect(started).toBe(1);
	});

	test("declines while a peer turn runs", async () => {
		let started = 0;
		const { deps } = harness({ status: bridgeStatus({ open: true, running: true }) });
		const { ctx, notices } = fakeCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await runNew(ctx, deps);
		// Replacing the session here would stop the bridge and drop the peer's turn.
		expect(started).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat new");
	});
});

describe("/wechat allow", () => {
	test("allows a refused sender in the project config after confirmation", async () => {
		const dir = tempDir("wechat-allow-");
		const { deps } = harness({ status: bridgeStatus({ refused: 1, refusedPeers: ["alice"] }) });
		const { ctx, notices, confirms } = fakeCtx({ cwd: dir, select: "alice", confirm: true });
		await handler(deps)("allow", ctx);
		const file = join(dir, CONFIG_DIR_NAME, "bytefly.json");
		expect(JSON.parse(readFileSync(file, "utf8")).wechat.allowedPeers).toEqual(["alice"]);
		expect(confirms[0]?.message).toContain("bytefly.json");
		expect(notices.at(-1)?.message).toContain("/reload");
	});

	test("writes nothing when the allow confirmation is declined", async () => {
		const dir = tempDir("wechat-allow-");
		const { deps } = harness({ status: bridgeStatus({ refused: 1, refusedPeers: ["alice"] }) });
		const { ctx } = fakeCtx({ cwd: dir, select: "alice", confirm: false });
		await handler(deps)("allow", ctx);
		expect(existsSync(join(dir, CONFIG_DIR_NAME, "bytefly.json"))).toBe(false);
	});

	test("allows an explicit peer without the picker", async () => {
		const dir = tempDir("wechat-allow-");
		const { deps } = harness();
		const { ctx, selects } = fakeCtx({ cwd: dir, confirm: true });
		await handler(deps)("allow bob", ctx);
		expect(selects).toEqual([]);
		const file = join(dir, CONFIG_DIR_NAME, "bytefly.json");
		expect(JSON.parse(readFileSync(file, "utf8")).wechat.allowedPeers).toEqual(["bob"]);
	});

	test("explains when there is nobody refused to allow", async () => {
		const { deps } = harness();
		const { ctx, notices, selects } = fakeCtx({ confirm: true });
		await handler(deps)("allow", ctx);
		expect(selects).toEqual([]);
		expect(notices.at(-1)?.message).toContain("No refused sender");
	});

	test("needs a confirmation dialog, which some modes have no UI for", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx({ mode: "json" });
		await handler(deps)("allow alice", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("confirmation dialog");
	});

	test("does not overwrite a malformed project config", async () => {
		const dir = tempDir("wechat-allow-");
		const file = join(dir, CONFIG_DIR_NAME, "bytefly.json");
		mkdirSync(join(dir, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(file, "{ broken");
		const { deps } = harness({ status: bridgeStatus({ refused: 1, refusedPeers: ["alice"] }) });
		const { ctx, notices } = fakeCtx({ cwd: dir, select: "alice", confirm: true });
		await handler(deps)("allow", ctx);
		expect(notices.at(-1)?.kind).toBe("error");
		expect(readFileSync(file, "utf8")).toBe("{ broken");
	});

	test("reports a sender that is already allowed", async () => {
		const { deps } = harness();
		deps.loadConfig = () => ({ ...DEFAULT_CONFIG, allowedPeers: ["alice"] });
		const { ctx, notices, confirms } = fakeCtx({ select: "alice", confirm: true });
		await handler(deps)("allow alice", ctx);
		expect(confirms).toEqual([]);
		expect(notices.at(-1)?.message).toContain("already allowed");
	});
});

describe("/wechat history", () => {
	test("prints a peer's recent history", async () => {
		const h = harness();
		h.deps.readHistory = async (peer, count) => `${peer} ${count}\nYou: hi`;
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("history alice", ctx);
		const text = notices.at(-1)?.message ?? "";
		expect(text).toContain("alice 10");
		expect(text).toContain("You: hi");
	});

	test("caps the requested count at 20", async () => {
		const counts: number[] = [];
		const h = harness();
		h.deps.readHistory = async (_peer, count) => {
			counts.push(count);
			return "You: hi";
		};
		const { ctx } = fakeCtx();
		await handler(h.deps)("history alice 99", ctx);
		expect(counts).toEqual([20]);
	});

	test("asks for a peer when there is no target", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx();
		await handler(deps)("history", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("Usage: /wechat history");
	});

	test("reports a read failure instead of failing the command", async () => {
		const h = harness();
		h.deps.readHistory = async () => {
			throw new Error("disk gone");
		};
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("history alice", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("disk gone");
	});
});

describe("/wechat pause and resume", () => {
	test("pauses and resumes polling", async () => {
		const paused = harness({ pause: true });
		const { ctx, notices } = fakeCtx();
		await handler(paused.deps)("pause", ctx);
		expect(paused.events).toEqual(["pause"]);
		expect(notices.at(-1)?.message).toContain("paused");

		const resumed = harness({ status: bridgeStatus({ paused: true }), resume: true });
		const resumedCtx = fakeCtx();
		await handler(resumed.deps)("resume", resumedCtx.ctx);
		expect(resumed.events).toEqual(["resume"]);
		expect(resumedCtx.notices.at(-1)?.message).toContain("resumed");
	});

	test("explains when there is nothing to pause or resume", async () => {
		const stop = harness({ pause: false });
		const stopCtx = fakeCtx();
		await handler(stop.deps)("pause", stopCtx.ctx);
		expect(stopCtx.notices.at(-1)?.message).toContain("not running");

		const resume = harness({ resume: true });
		const resumeCtx = fakeCtx();
		await handler(resume.deps)("resume", resumeCtx.ctx);
		expect(resumeCtx.notices.at(-1)?.message).toContain("not paused");
	});

	test("explains that pause needs a running bridge", async () => {
		const { deps } = harness({ bridge: false });
		const { ctx, notices } = fakeCtx();
		await handler(deps)("pause", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("not running");
	});
});

describe("/wechat doctor", () => {
	test("prints a health report", async () => {
		const { deps } = harness({ status: bridgeStatus({ open: true, lastPollAt: 500, lock: { pid: 1, at: 1 } }) });
		const { ctx, notices } = fakeCtx();
		await handler(deps)("doctor", ctx);
		const text = notices.at(-1)?.message ?? "";
		expect(text).toContain("wechat — health");
		expect(text).toContain("Poll");
		expect(text).toContain("Lock");
	});
});

describe("/wechat logout", () => {
	test("needs a confirmation dialog, which some modes have no UI for", async () => {
		const { deps, logouts } = harness();
		const { ctx, notices } = fakeCtx({ mode: "json" });
		await handler(deps)("logout", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("confirmation dialog");
		expect(logouts()).toBe(0);
	});

	test("leaves the bridge alone when the confirmation is declined", async () => {
		const { deps, events, logouts } = harness();
		const { ctx, confirms } = fakeCtx({ confirm: false });
		await handler(deps)("logout", ctx);
		expect(confirms.length).toBe(1);
		expect(events).toEqual([]);
		expect(logouts()).toBe(0);
	});

	test("closes the bridge and clears the account on confirmation", async () => {
		const { deps, events, logouts } = harness();
		const { ctx, notices } = fakeCtx({ confirm: true });
		await handler(deps)("logout", ctx);
		expect(events).toEqual(["close"]);
		expect(logouts()).toBe(1);
		expect(notices.at(-1)?.message).toBe("WeChat logged out.");
	});
});

describe("peer controls", () => {
	const state = bridgeStatus({
		peerStates: [{ peer: "alice@im.wechat", state: { status: "running", queued: 0 } }],
	});

	test("stops a peer by either id form", async () => {
		const h = harness({ status: state, stop: true });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("stop alice", ctx);
		expect(h.stops).toEqual(["alice@im.wechat"]);
		expect(notices.at(-1)?.message).toContain("Stopping alice");
	});

	test("resets a peer conversation", async () => {
		const h = harness({ status: state, reset: true });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("reset ALICE@im.wechat", ctx);
		expect(h.resets).toEqual(["alice@im.wechat"]);
		expect(notices.at(-1)?.message).toContain("fresh conversation for alice");
	});

	test("refuses a reset while the peer runs", async () => {
		const h = harness({ status: state, reset: false });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("reset alice", ctx);
		expect(notices.at(-1)?.message).toContain("stop it before");
	});

	test("names the known peers on an unknown target", async () => {
		const h = harness({ status: state });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("stop nobody", ctx);
		expect(h.stops).toEqual([]);
		expect(notices.at(-1)?.message).toContain('Unknown WeChat peer "nobody"');
		expect(notices.at(-1)?.message).toContain("alice");
	});

	test("asks for login when no bridge is started", async () => {
		const h = harness({ bridge: false });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("stop alice", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat login");
	});
});

/**
 * While a peer turn runs, the terminal's own dialogs still work (the bridge does
 * not adapt the host UI), but a `/wechat` verb that would stop the bridge or
 * replace the host session declines instead.
 */
describe("the /wechat command during a WeChat turn", () => {
	test("prints the one-line summary instead of opening the control screen", async () => {
		const { deps } = harness({ status: bridgeStatus({ open: true, running: true }) });
		const { ctx, notifications, customCalls } = fakeCtx({ custom: "close" });
		await handler(deps)("status", ctx);
		expect(customCalls).toEqual([]);
		expect(notifications.at(-1)).toContain("wechat:");
	});

	test("declines logout before asking for a confirmation", async () => {
		const { deps, logouts } = harness({ status: bridgeStatus({ open: true, running: true }) });
		const { ctx, notices, confirms } = fakeCtx({ hasUI: true, confirm: true });
		await handler(deps)("logout", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat logout");
		expect(confirms).toEqual([]);
		expect(logouts()).toBe(0);
	});

	test("declines new instead of replacing the session under the turn", async () => {
		let started = 0;
		const { deps } = harness({ status: bridgeStatus({ open: true, running: true }) });
		const { ctx, notices } = fakeCtx({
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
		const { deps } = harness({ status: bridgeStatus({ open: true, running: true }) });
		const { ctx, notices } = fakeCtx();
		// The harness login client throws, so reaching it would fail this test.
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat login");
	});

	test("opens the control screen again once the peer turn settles", async () => {
		const running = bridgeStatus({ open: true, running: true });
		const { deps } = harness({ status: running });
		const { ctx, customCalls } = fakeCtx({ custom: "close" });
		const command = handler(deps);
		await command("status", ctx);
		expect(customCalls).toEqual([]);

		// The bridge reports the turn gone; the next `/wechat` is local again.
		running.running = false;
		await command("status", ctx);
		expect(customCalls.length).toBe(1);
	});
});

describe("slash parsing", () => {
	test("parses a bare command and trims the surrounding text", () => {
		expect(parseSlash("/new")).toEqual({ name: "new", args: "" });
		expect(parseSlash("  /new  ")).toEqual({ name: "new", args: "" });
	});

	test("lowercases the name and keeps the args", () => {
		expect(parseSlash("/NeW keep this")).toEqual({ name: "new", args: "keep this" });
		expect(parseSlash("/new\nmulti\nline")).toEqual({ name: "new", args: "multi\nline" });
	});

	test("rejects text that is not a command", () => {
		expect(parseSlash("hello")).toBeUndefined();
		expect(parseSlash("/")).toBeUndefined();
		expect(parseSlash("/ with space")).toBeUndefined();
	});

	test("findSlashCommand matches case-insensitively and ignores unknown names", () => {
		expect(findSlashCommand(SLASH_COMMANDS, "NEW")?.name).toBe("new");
		expect(findSlashCommand(SLASH_COMMANDS, "nope")).toBeUndefined();
		// A path-like message parses to a name that is not registered.
		expect(findSlashCommand(SLASH_COMMANDS, parseSlash("/usr/local")?.name ?? "")).toBeUndefined();
	});

	test("expandSnippet appends args as a separate paragraph and handles a bodyless snippet", () => {
		const snippet: SlashCommand = {
			name: "summarize",
			summary: "Summarize the current context",
			kind: "snippet",
			snippet: "Summarize what we have so far.",
		};
		expect(expandSnippet(snippet, "")).toBe("Summarize what we have so far.");
		expect(expandSnippet(snippet, "about the tests")).toBe("Summarize what we have so far.\n\nabout the tests");
		expect(expandSnippet({ name: "x", summary: "", kind: "snippet" }, "only args")).toBe("only args");
	});
});

describe("built-in /stop and /status", () => {
	function context(
		overrides: Partial<SlashContext> = {},
		state: SlashPeerState = { status: "idle", queued: 0 },
		history: (count: number) => Promise<string> = async () => "",
	) {
		const replies: string[] = [];
		let stopped = 0;
		const ctx = {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text: string) => {
				replies.push(text);
			},
			activeTurn: state.status === "running",
			language: "en",
			session: {
				newSession: () => {},
				stop: () => {
					stopped += 1;
					return stopped === 1 && state.status === "running";
				},
				status: () => state,
				history,
			},
			...overrides,
		} satisfies SlashContext;
		return { ctx, replies, stopped: () => stopped };
	}

	test("/stop asks the session to abort and stays quiet when it did", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies, stopped } = context({}, { status: "running", queued: 0 });
		await command?.run?.(ctx);
		expect(stopped()).toBe(1);
		// The stopped turn answers with its own `Stopped.`, so no second bubble.
		expect(replies).toEqual([]);
	});

	test("/stop says so when nothing is running", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies } = context();
		await command?.run?.(ctx);
		expect(replies).toEqual(["Nothing is running right now."]);
	});

	test("/status reports the running turn and its queue", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "running", queued: 2, runningMs: 12_400 });
		await command?.run?.(ctx);
		expect(replies).toEqual(["Working — 12s so far, 2 queued."]);
	});

	test("/status reports an idle conversation", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context();
		await command?.run?.(ctx);
		expect(replies).toEqual(["Idle."]);
	});

	test("/status reports a queued conversation", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "queued", queued: 3 });
		await command?.run?.(ctx);
		expect(replies[0]).toContain("3");
	});

	test("/status answers a Chinese peer in Chinese", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({ language: "zh" }, { status: "running", queued: 0, runningMs: 3000 });
		await command?.run?.(ctx);
		expect(replies[0]).toContain("正在处理，已用 3 秒");
	});

	test("/status names the dialog a blocked turn is waiting on", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context(
			{},
			{ status: "running", queued: 0, runningMs: 3000, prompt: "Plan mode — what next?" },
		);
		await command?.run?.(ctx);
		// The dialog is the only thing the peer can act on, so it replaces the timer.
		expect(replies[0]).toContain("Plan mode — what next?");
		expect(replies[0]).toContain("cancel");
		expect(replies[0]).not.toContain("3s so far");
	});

	test("/history replies with the peer's own recent messages", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const { ctx, replies } = context({}, { status: "idle", queued: 0 }, async () => "You: hi\nMe: hello");
		await command?.run?.(ctx);
		expect(replies).toEqual(["You: hi\nMe: hello"]);
	});

	test("/history defaults to 8 and caps the request at 20", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const counts: number[] = [];
		const { ctx } = context({}, { status: "idle", queued: 0 }, async (count) => {
			counts.push(count);
			return "";
		});
		await command?.run?.({ ...ctx, args: "" });
		await command?.run?.({ ...ctx, args: "99" });
		expect(counts).toEqual([8, 20]);
	});

	test("/history says so when there is nothing yet", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const { ctx, replies } = context({}, { status: "idle", queued: 0 });
		await command?.run?.(ctx);
		expect(replies).toEqual(["No history yet in this conversation."]);
	});
});

describe("built-in /new", () => {
	function context(events: string[]): SlashContext {
		return {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				events.push(`reply:${text}`);
			},
			activeTurn: false,
			language: "en",
			session: {
				newSession: () => {
					events.push("newSession");
				},
				stop: () => false,
				status: () => ({ status: "idle", queued: 0 }),
			},
		};
	}

	test("is an owner-only action", () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		expect(command?.kind).toBe("action");
		expect(command?.ownerOnly).toBe(true);
	});

	test("replies before starting the session", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		const events: string[] = [];
		await command?.run?.(context(events));
		expect(events[0]).toContain("reply:Starting a new session");
		expect(events[1]).toBe("newSession");
	});

	test("declines while a turn is in flight instead of restarting", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		const events: string[] = [];
		await command?.run?.({ ...context(events), activeTurn: true });
		expect(events).toHaveLength(1);
		expect(events[0]).toContain("Still working on your last message");
	});

	test("answers a Chinese peer in Chinese", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		const events: string[] = [];
		await command?.run?.({ ...context(events), activeTurn: true, language: "zh" });
		expect(events[0]).toContain("/new");
		expect(events[0]).toMatch(/[\u3400-\u9fff]/);
	});
});

describe("built-in /help", () => {
	function context(events: string[]): SlashContext {
		return {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				events.push(text);
			},
			activeTurn: false,
			language: "en",
			session: { newSession: () => {}, stop: () => false, status: () => ({ status: "idle", queued: 0 }) },
		};
	}

	test("is a non-owner action", () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		expect(command?.kind).toBe("action");
		expect(command?.ownerOnly).toBeUndefined();
	});

	test("replies with the command list", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		const replies: string[] = [];
		await command?.run?.(context(replies));
		expect(replies[0]).toContain("/new");
		expect(replies[0]).toContain("/help");
		expect(replies[0]).toContain("owner only");
	});

	test("replies in Chinese for a Chinese peer", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		const replies: string[] = [];
		await command?.run?.({ ...context(replies), language: "zh" });
		expect(replies[0]).toContain("可用命令：");
		expect(replies[0]).toContain("/new — 开始新会话（仅限所有者）");
		expect(replies[0]).not.toContain("owner only");
	});
});

describe("helpText", () => {
	test("lists each command and marks owner-only ones", () => {
		const text = helpText([
			{ name: "new", summary: "Start a new session", kind: "action", ownerOnly: true },
			{ name: "help", summary: "List the chat commands", kind: "action" },
		]);
		expect(text).toContain("/new — Start a new session (owner only)");
		expect(text).toContain("/help — List the chat commands");
		expect(text).toContain("reaches the agent");
	});

	test("speaks Chinese when the peer does, falling back to the English summary", () => {
		const text = helpText(
			[
				{ name: "new", summary: "Start a new session", summaryZh: "开始新会话", kind: "action", ownerOnly: true },
				{ name: "help", summary: "List the chat commands", kind: "action" },
			],
			"zh",
		);
		expect(text).toContain("/new — 开始新会话（仅限所有者）");
		// A command without a Chinese summary falls back to the English one.
		expect(text).toContain("/help — List the chat commands");
		expect(text).toContain("其他内容都会发送给助手。");
	});
});

describe("notices", () => {
	// Every kind the bridge can send, so a new one is covered by these checks.
	const KINDS: NoticeKind[] = [
		"ack",
		"busy",
		"stillWorking",
		"overflow",
		"media",
		"unsupported",
		"stopped",
		"noText",
		"compacted",
		"budget",
		"promptWaiting",
		"timeout",
		"withdrawn",
		"failed",
		"newBusy",
	];

	test("renders the peer's language only", () => {
		const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/;
		for (const kind of KINDS) {
			expect(cjk.test(notice(kind, "zh"))).toBe(true);
			expect(cjk.test(notice(kind, "en"))).toBe(false);
		}
	});

	test("fills in a count", () => {
		expect(notice("media", "en", 2)).toContain("2");
		expect(notice("media", "zh", 2)).toContain("2 个附件");
	});

	test("keeps every notice to one line", () => {
		for (const kind of KINDS) {
			for (const lang of ["en", "zh"] as const) expect(notice(kind, lang)).not.toContain("\n");
		}
	});
});

describe("formatPrompt", () => {
	function request(
		partial: Partial<InteractionRequest> & Pick<InteractionRequest, "kind" | "title">,
	): InteractionRequest {
		return partial;
	}

	test("numbers select options and appends the hint", () => {
		const text = formatPrompt(
			request({ kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] }),
			{ language: "zh" },
		);
		expect(text).toContain("Pick");
		expect(text).toContain("1. A");
		expect(text).toContain("2. B");
		expect(text).toContain("3. Other (type something)");
		expect(text).toContain("取消");
	});

	test("renders one language per peer", () => {
		const request: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };
		const zh = formatPrompt(request, { language: "zh" });
		const en = formatPrompt(request, { language: "en" });
		expect(zh).toContain("回复编号");
		expect(zh).not.toContain("Reply with a number");
		expect(en).toContain("Reply with a number");
		expect(en).not.toContain("回复编号");
	});

	test("does not promise free text when the select has no Other option", () => {
		const text = formatPrompt(request({ kind: "select", title: "Plan mode", options: ["Approve", "Exit"] }), {
			language: "zh",
		});
		expect(text).not.toContain("anything else becomes");
		expect(text).toContain("回复编号或选项文字");
		expect(text).toContain("取消");
	});

	test("prepends the retry notice only when asked", () => {
		const confirm = request({ kind: "confirm", title: "Sure?" });
		expect(formatPrompt(confirm)).not.toContain("didn't recognize");
		expect(formatPrompt(confirm, { retry: true }).startsWith(RETRY_NOTICE)).toBe(true);
	});

	test("includes the confirm body and the editor's prefill", () => {
		expect(formatPrompt(request({ kind: "confirm", title: "Sure?", message: "This deletes files." }))).toContain(
			"This deletes files.",
		);
		expect(formatPrompt(request({ kind: "editor", title: "Edit", prefill: "line one" }))).toContain("line one");
	});
});

describe("parsePromptAnswer select", () => {
	const base: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };

	test("maps a number to its option", () => {
		expect(parsePromptAnswer(base, "2")).toEqual({ kind: "value", value: "B" });
	});

	test("maps an exact label case-insensitively", () => {
		expect(parsePromptAnswer(base, "a")).toEqual({ kind: "value", value: "A" });
	});

	test("treats free text as the other option", () => {
		expect(parsePromptAnswer(base, "something else")).toEqual({ kind: "other", text: "something else" });
	});

	test("cancels on a cancel word", () => {
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "退出")).toEqual({ kind: "cancelled" });
	});

	test("recognizes an exit-plan phrase as a cancel", () => {
		expect(parsePromptAnswer(base, "退出 plan 模式")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit plan mode")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "leave plan")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit code")).toEqual({ kind: "other", text: "exit code" });
	});

	test("retries an out-of-range number", () => {
		expect(parsePromptAnswer(base, "9")).toEqual({ kind: "retry" });
	});

	test("retries free text when there is no other option", () => {
		const noOther: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B"] };
		expect(parsePromptAnswer(noOther, "huh")).toEqual({ kind: "retry" });
	});

	test("retries empty input", () => {
		expect(parsePromptAnswer(base, "  ")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer confirm", () => {
	const base: InteractionRequest = { kind: "confirm", title: "Sure?" };

	test("accepts yes words", () => {
		expect(parsePromptAnswer(base, "是")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "YES")).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("accepts no words and cancel as false", () => {
		expect(parsePromptAnswer(base, "否")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("accepts the everyday Chinese answers", () => {
		expect(parsePromptAnswer(base, "确定")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "行")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "不是")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "不行")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("retries anything else", () => {
		expect(parsePromptAnswer(base, "maybe")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer input and editor", () => {
	test("input returns the text, cancels on a cancel word, and retries empty", () => {
		const input: InteractionRequest = { kind: "input", title: "Name" };
		expect(parsePromptAnswer(input, "Ada")).toEqual({ kind: "value", value: "Ada" });
		expect(parsePromptAnswer(input, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(input, "")).toEqual({ kind: "retry" });
	});

	test("editor returns the text and treats empty as cancelled", () => {
		const editor: InteractionRequest = { kind: "editor", title: "Edit" };
		expect(parsePromptAnswer(editor, "1, 3")).toEqual({ kind: "value", value: "1, 3" });
		expect(parsePromptAnswer(editor, "")).toEqual({ kind: "cancelled" });
	});

	test("strips control characters", () => {
		expect(parsePromptAnswer({ kind: "input", title: "Name" }, "A\u0007da")).toEqual({ kind: "value", value: "A da" });
	});
});

/** A timer seam keyed by delay, so the reminder and the expiry fire apart. */
function timerSeam(): { arm: ArmTimer; fire: (ms: number) => void; armed: () => number } {
	const pending = new Map<number, { ms: number; fn: () => void }>();
	let next = 0;
	return {
		arm: (ms, fn) => {
			next += 1;
			const id = next;
			pending.set(id, { ms, fn });
			return () => pending.delete(id);
		},
		fire: (ms) => {
			for (const [id, timer] of [...pending]) {
				if (timer.ms !== ms) continue;
				pending.delete(id);
				timer.fn();
			}
		},
		armed: () => pending.size,
	};
}

const SELECT: InteractionRequest = {
	kind: "select",
	title: "Pick",
	options: ["A", "B", INTERACTION_OTHER_LABEL],
};
const INPUT: InteractionRequest = { kind: "input", title: "Name" };
const CONFIRM: InteractionRequest = { kind: "confirm", title: "Sure?" };

/** One interaction channel over recording senders and a mutable active peer. */
function setupChannel(
	initialPeer: string | undefined = "owner",
	options: { timer?: ArmTimer; language?: PeerLanguage; now?: () => number } = {},
) {
	const sent: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	let peer: string | undefined = initialPeer;
	const deps: WechatInteractionDeps = {
		send: async (text) => {
			sent.push(text);
			return true;
		},
		sendFile: async (path, name) => {
			files.push({ path, name });
			return true;
		},
		activePeer: () => peer,
		language: () => options.language ?? "en",
		armTimer: options.timer,
		now: options.now,
	};
	const channel = createWechatInteractionChannel(deps);
	return { channel, sent, files, setPeer: (value: string | undefined) => (peer = value) };
}

describe("interaction channel", () => {
	test("post and postFile delegate to the bridge's senders", async () => {
		const { channel, sent, files } = setupChannel();
		await channel.post("hello");
		expect(sent).toEqual(["hello"]);
		expect(await channel.postFile("/tmp/plan.md", "plan.md")).toBe(true);
		expect(files).toEqual([{ path: "/tmp/plan.md", name: "plan.md" }]);
	});

	test("isActive follows the active peer", () => {
		const { channel, setPeer } = setupChannel();
		expect(channel.isActive()).toBe(true);
		setPeer(undefined);
		expect(channel.isActive()).toBe(false);
	});

	test("hasPending tracks whether a reply is awaited", async () => {
		const { channel } = setupChannel();
		expect(channel.hasPending()).toBe(false);
		const answer = channel.request(SELECT);
		expect(channel.hasPending()).toBe(true);
		channel.handleInbound("owner", "1");
		await answer;
		expect(channel.hasPending()).toBe(false);
	});

	test("pendingInfo exposes the peer, kind, title, and start time", async () => {
		const { channel } = setupChannel("alice", { now: () => 1_000 });
		const answer = channel.request(SELECT);
		expect(channel.pendingInfo()).toEqual({
			peer: "alice",
			kind: "select",
			title: "Pick",
			startedAt: 1_000,
		});
		expect(channel.handleInbound("alice", "2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
		expect(channel.pendingInfo()).toBeUndefined();
	});

	test("cancels on demand, tells the peer once, and clears the prompt", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		channel.cancel();
		expect(await answer).toEqual({ kind: "cancelled" });
		// A withdrawal is not an expiry: the peer was not slow, the question left.
		expect(sent.at(-1)).toBe("That question was withdrawn.");
		expect(channel.hasPending()).toBe(false);
	});

	test("reset stays silent: it is cleanup, not a withdrawal", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent).toHaveLength(1);
	});

	test("sends the prompt and resolves on a matching reply", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		expect(sent).toHaveLength(1);
		expect(channel.handleInbound("owner", "2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
	});

	test("cancels immediately without an active peer", async () => {
		const { channel, setPeer } = setupChannel();
		setPeer(undefined);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("cancels a concurrent second request", async () => {
		const { channel } = setupChannel();
		const first = channel.request(SELECT);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
		channel.handleInbound("owner", "1");
		await first;
	});

	test("cancels on abort", async () => {
		const { channel } = setupChannel();
		const controller = new AbortController();
		const answer = channel.request(SELECT, controller.signal);
		controller.abort();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("cancels when the send fails", async () => {
		const deps: WechatInteractionDeps = {
			send: async () => false,
			sendFile: async () => false,
			activePeer: () => "owner",
			language: () => "en",
		};
		const channel = createWechatInteractionChannel(deps);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("reminds once and then cancels an unanswered prompt", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel("owner", { timer: timers.arm });
		const answer = channel.request(CONFIRM);
		expect(sent).toHaveLength(1); // the prompt itself

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("Waiting for your reply");
		expect(channel.hasPending()).toBe(true);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("That question timed out.");
		expect(channel.hasPending()).toBe(false);
	});

	test("cancels the timeout timers once the peer answers", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel("owner", { timer: timers.arm });
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("owner", "yes")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
		expect(timers.armed()).toBe(0);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(sent).toHaveLength(1);
	});

	test("speaks the peer's language in the timeout notices", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel("owner", { timer: timers.arm, language: "zh" });
		const answer = channel.request(CONFIRM);

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("等你回复");
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("问题超时，已取消。");
	});

	test("honours a scoped bound and restores the default when it ends", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel("owner", { timer: timers.arm });
		const restore = channel.setPromptTimeout(600_000);
		const answer = channel.request(CONFIRM);

		// The default bound is not in force while the scope is open.
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(channel.hasPending()).toBe(true);
		timers.fire(300_000);
		expect(sent.at(-1)).toContain("Waiting for your reply");
		timers.fire(600_000);
		expect(await answer).toEqual({ kind: "cancelled" });
		restore();

		const next = channel.request(CONFIRM);
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await next).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("That question timed out.");
	});

	test("handleInbound ignores a reply from another peer", async () => {
		const { channel } = setupChannel();
		const answer = channel.request(SELECT);
		expect(channel.handleInbound("stranger", "1")).toBe(false);
		expect(channel.handleInbound("owner", "1")).toBe(true);
		await answer;
	});

	test("handleInbound ignores an inbound message with no pending prompt", () => {
		const { channel } = setupChannel();
		expect(channel.handleInbound("owner", "hi")).toBe(false);
	});

	test("handleInbound re-prompts with a notice on a retry and keeps waiting", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("owner", "maybe")).toBe(true);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("didn't recognize");
		expect(channel.handleInbound("owner", "是")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("handleInbound maps a cancel word to cancelled", async () => {
		const { channel } = setupChannel();
		const answer = channel.request(SELECT);
		channel.handleInbound("owner", "取消");
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("a select free text becomes Other and the next input returns it", async () => {
		const { channel, sent } = setupChannel();
		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		const before = sent.length;
		expect(await channel.request(INPUT)).toEqual({ kind: "value", value: "custom value" });
		expect(sent.length).toBe(before);
	});

	test("reset resolves a pending prompt as cancelled and clears the other stash", async () => {
		const { channel } = setupChannel();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });

		const select = channel.request(SELECT);
		channel.handleInbound("owner", "custom value");
		await select;
		channel.reset();
		// The stash is gone, so the next input is a fresh prompt rather than a replay.
		const input = channel.request(INPUT);
		expect(channel.handleInbound("owner", "typed")).toBe(true);
		expect(await input).toEqual({ kind: "value", value: "typed" });
	});
});

/**
 * Free text from an "Other" answer belongs to the peer who typed it. One prompt
 * runs at a time, but a stash keyed globally would hand peer A's text to peer B's
 * next input.
 */
describe("other-answer ownership", () => {
	test("returns free text to the peer who typed it, and to nobody else", async () => {
		const { channel, sent, setPeer } = setupChannel("alice");
		const aliceSelect = channel.request(SELECT);
		expect(channel.handleInbound("alice", "something else")).toBe(true);
		expect(await aliceSelect).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		// Another peer asks for input first: Alice's text must not leak into it.
		setPeer("bob");
		const bobInput = channel.request(INPUT);
		expect(channel.handleInbound("bob", "bob answer")).toBe(true);
		expect(await bobInput).toEqual({ kind: "value", value: "bob answer" });

		// Alice's own next input still gets her stashed text, without a round-trip.
		setPeer("alice");
		expect(await channel.request(INPUT)).toEqual({ kind: "value", value: "something else" });
		// The stashed answer costs no prompt; only the two real prompts were sent.
		expect(sent).toHaveLength(2);
	});
});

function fakeChannel(answer: InteractionAnswer = { kind: "value", value: "remote" }) {
	const requests: InteractionRequest[] = [];
	const posted: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	/** Every delivery in call order, so the preface-before-dialogs contract is pinned. */
	const events: string[] = [];
	let next = answer;
	let fileResult = true;
	const channel: InteractionChannel = {
		isActive: () => true,
		request: async (request) => {
			requests.push(request);
			events.push(`request:${request.kind}`);
			return next;
		},
		post: async (text) => {
			posted.push(text);
			events.push(`post:${text}`);
		},
		postFile: async (path, name) => {
			files.push({ path, name });
			events.push(`file:${name}`);
			return fileResult;
		},
	};
	return {
		channel,
		requests,
		posted,
		files,
		events,
		setAnswer: (value: InteractionAnswer) => {
			next = value;
		},
		setFileResult: (value: boolean) => {
			fileResult = value;
		},
	};
}

/**
 * A peer session has no terminal, so its extensions get a UI bound to that
 * peer's channel instead: dialogs go to the phone and nothing draws locally.
 */
describe("peer UI context", () => {
	test("routes each dialog to the peer", async () => {
		const { channel, requests } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(await ui.select("Pick", ["A", "B"])).toBe("remote");
		expect(await ui.input("Name", "hint")).toBe("remote");
		expect(await ui.editor("Edit", "draft")).toBe("remote");
		expect(requests.map((request) => request.kind)).toEqual(["select", "input", "editor"]);
	});

	test("maps a confirm answer to a boolean", async () => {
		const { channel, setAnswer } = fakeChannel();
		const ui = createPeerUIContext(channel);
		setAnswer({ kind: "confirmed", confirmed: true });
		expect(await ui.confirm("Sure?", "body")).toBe(true);
		setAnswer({ kind: "confirmed", confirmed: false });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
		setAnswer({ kind: "cancelled" });
		expect(await ui.confirm("Sure?", "body")).toBe(false);
	});

	test("posts a notification to the peer and reports it locally", async () => {
		const { channel, posted } = fakeChannel();
		const notices: string[] = [];
		const ui = createPeerUIContext(channel, (message) => notices.push(message));
		ui.notify("heads up", "warning");
		await Promise.resolve();
		expect(posted).toEqual(["heads up"]);
		expect(notices).toEqual(["heads up"]);
	});

	test("has no terminal: custom is unavailable and drawing is a no-op", async () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		const custom = ui.custom as (factory: unknown) => Promise<unknown>;
		expect(await custom(async () => ({}))).toBeUndefined();
		// These must exist and be harmless, because extensions call them blindly.
		ui.setStatus("k", "v");
		ui.setWidget("k", ["line"]);
		ui.setTitle("t");
		ui.setWorkingMessage("m");
		ui.pasteToEditor("x");
		expect(ui.getEditorText()).toBe("");
		expect(ui.getTheme("x")).toBeUndefined();
		// A theme object exists so a renderer that never runs cannot crash on load.
		expect(ui.theme).toBeDefined();
	});
});

/**
 * The peer context carries the channel marker `askHuman` reads. The terminal's
 * own UI is never marked, so a local turn keeps its full-screen dialogs even
 * while a peer turn runs.
 */
describe("peer turn marker", () => {
	test("reports the channel through remoteChannel and isRemoteTurn", () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel);
		expect(remoteChannel({ ui })).toBe(channel);
		expect(isRemoteTurn({ ui })).toBe(true);
	});

	test("askHuman sends the file preface to the peer before the dialogs", async () => {
		const { channel, events } = fakeChannel();
		const ui = createPeerUIContext(channel);
		const answer = await askHuman(
			{ ui, mode: "rpc" },
			{
				custom: async () => "custom",
				dialogs: async () => ui.select("Plan mode — what next?", ["Approve and execute"]),
				file: { path: "/tmp/plan.md", name: "plan.md" },
				body: "the plan",
			},
		);
		// One ordered log: the file goes out first, then the dialog.
		expect(events).toEqual(["file:plan.md", "request:select"]);
		expect(answer).toBe("remote");
	});

	test("falls back to the body when the file could not be sent", async () => {
		const { channel, events, setFileResult } = fakeChannel();
		setFileResult(false);
		const ui = createPeerUIContext(channel);
		await askHuman(
			{ ui, mode: "rpc" },
			{
				custom: async () => "custom",
				dialogs: async () => ui.select("Plan mode — what next?", ["Keep planning"]),
				file: { path: "/tmp/plan.md", name: "plan.md" },
				body: "the plan",
			},
		);
		expect(events).toEqual(["file:plan.md", "post:the plan", "request:select"]);
	});
});

/**
 * The `remotePrompts` setting turns forwarding off: a dialog is answered as
 * cancelled instead of being sent to the phone, and the marker is absent so
 * `askHuman` does not try to deliver a preface either.
 */
describe("peer UI context with prompts disabled", () => {
	test("answers every dialog as cancelled without asking the peer", async () => {
		const { channel, requests } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		expect(await ui.select("Pick", ["A"])).toBeUndefined();
		expect(await ui.input("Name")).toBeUndefined();
		expect(await ui.editor("Edit")).toBeUndefined();
		expect(await ui.confirm("Sure?", "body")).toBe(false);
		expect(requests).toEqual([]);
	});

	test("does not mark the context as remote", () => {
		const { channel } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		expect(remoteChannel({ ui })).toBeUndefined();
		expect(isRemoteTurn({ ui })).toBe(false);
	});

	test("still posts notifications to the peer", async () => {
		const { channel, posted } = fakeChannel();
		const ui = createPeerUIContext(channel, undefined, { prompts: false });
		ui.notify("heads up");
		await Promise.resolve();
		expect(posted).toEqual(["heads up"]);
	});
});
