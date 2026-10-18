import { describe, expect, test } from "bun:test";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { coloringTheme, createFakePi, emit } from "../../test/helpers/fakes.ts";
import {
	fakePeerSession,
	fakeWechatClient,
	inboundText,
	updates,
	writeAccount,
} from "../../test/helpers/fixtures/wechat.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import wechat, { wechatChip } from "./index.ts";
import type { PeerSession } from "./peer-session.ts";

describe("wechat extension", () => {
	test("registers the /wechat command", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		expect(fake.commands.has("wechat")).toBe(true);
	});

	test("completes the wechat subcommands", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		const complete = (prefix: string): string[] =>
			(fake.commands.get("wechat").getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["login", "new", "status", "logout", "help"]);
		expect(complete("n")).toEqual(["new"]);
		expect(complete("new ")).toEqual([]);
	});

	test("registers the send_wechat tool", () => {
		const fake = createFakePi();
		wechat(fake.pi);
		expect(fake.tools.has("send_wechat")).toBe(true);
	});

	test("does not open the bridge when no account is stored", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, notifications } = fakeCtx({ mode: "rpc" });
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("closed");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("opens the status screen in the TUI", async () => {
		await withAgentDir(async () => {
			const fake = createFakePi();
			wechat(fake.pi);
			const { ctx, customCalls } = fakeCtx({ custom: "close" });
			await fake.commands.get("wechat").handler("status", ctx);
			expect(customCalls.length).toBe(1);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("renders a chip for every bridge state, persistent for an expiry", () => {
		expect(wechatChip(coloringTheme, "running")).toBe(`[success]${GLYPHS.wechat} wechat`);
		expect(wechatChip(coloringTheme, "expired")).toBe(`[error]${GLYPHS.wechat} wechat expired`);
		expect(wechatChip(coloringTheme, "stopped")).toBeUndefined();
	});
});

/**
 * The lifecycle contract: one poller per runtime, opened when an account is
 * stored, answering inbound turns, and released on shutdown. Driven through the
 * real bridge with only the transport and the timer injected.
 */
describe("wechat lifecycle", () => {
	async function start(dir: string, script = [updates()], answer = "hi from pi") {
		const fake = createFakePi();
		const client = fakeWechatClient(script);
		const peers = fakePeerSession(answer);
		wechat(fake.pi, { createClient: client.createClient, sleep: client.sleep, openSession: peers.openSession });
		const result = fakeCtx({ mode: "rpc", cwd: dir });
		await emit(fake.pi, "session_start", { type: "session_start" }, result.ctx);
		return { fake, client, peers, ...result };
	}

	test("connects a stored account on session_start", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, ctx, notifications } = await start(dir);

			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("open");

			const tool = fake.tools.get("send_wechat");
			const result = await tool.execute("id", { text: "hi" }, undefined, undefined, ctx);
			expect(result.content[0].text).toBe("Sent to the WeChat owner.");

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("keeps one poller when session_start is emitted twice", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = await start(dir);

			// RPC binds the session twice on a session switch.
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			expect(client.clients()).toBe(1);

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("answers an inbound message after a restart", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = await start(dir, [updates([inboundText("hello")])]);

			// The inbound message runs in the peer's own session, so the host
			// transcript never sees it.
			await waitFor(() => client.sent.length === 1);
			expect(client.sent[0]).toMatchObject({ to: "owner@im.wechat", text: "hi from pi" });
			expect(fake.sentMessages).toEqual([]);

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("keeps the terminal's dialogs local while a peer turn runs", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const fake = createFakePi();
			const client = fakeWechatClient([updates([inboundText("hello")])]);
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const session = {
				async prompt(): Promise<void> {
					await held;
				},
				getLastAssistantText: () => "",
				subscribe: () => () => {},
				async abort(): Promise<void> {
					release();
				},
				dispose(): void {},
			};
			wechat(fake.pi, {
				createClient: client.createClient,
				sleep: client.sleep,
				openSession: async () => ({ session, dispose: () => {} }) as unknown as PeerSession,
			});
			const { ctx, notifications, selects } = fakeCtx({ mode: "tui", cwd: dir, hasUI: true, select: "local" });
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await waitFor(() => client.polls() >= 1);

			// The peer turn is in flight: the control screen's summary says so.
			const command = fake.commands.get("wechat").handler;
			let summary = "";
			for (let attempt = 0; attempt < 50 && !summary.includes("running"); attempt++) {
				await command("status", ctx);
				summary = notifications.at(-1) ?? "";
				if (!summary.includes("running")) await settle();
			}
			expect(summary, "the peer turn should be running").toContain("running");

			// The host UI is not adapted to the peer's channel: a terminal dialog
			// stays in the terminal instead of being answered on the phone.
			expect(isRemoteTurn({ ui: ctx.ui })).toBe(false);
			expect(await ctx.ui.select("Pick", ["A", "B"])).toBe("local");
			expect(selects).toHaveLength(1);

			release();
			// The held turn produced no text, so the bridge sends its noText fallback.
			await waitFor(() => client.sent.length === 1);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("stops polling and clears its handles on session_shutdown", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx, statuses } = await start(dir);
			await waitFor(() => client.polls() >= 1);
			expect(statuses.get("wechat")).toContain("wechat");
			const polls = client.polls();

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
			expect(client.aborts()).toBe(1);
			expect(client.polls()).toBe(polls);
			expect(statuses.get("wechat")).toBeUndefined();

			// A second shutdown (reload, replacement, process exit) must not throw.
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("clears the bridge when the account is logged out", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const fake = createFakePi();
			const client = fakeWechatClient([updates()]);
			wechat(fake.pi, { createClient: client.createClient, sleep: client.sleep });
			const { ctx, notices } = fakeCtx({ mode: "rpc", cwd: dir, hasUI: true, confirm: true });
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await waitFor(() => client.polls() >= 1);

			await fake.commands.get("wechat").handler("logout", ctx);
			expect(client.aborts()).toBe(1);
			expect(notices.at(-1)?.message).toBe("WeChat logged out.");

			// The account is the on/off switch: the summary must report neither the
			// old account nor the old bridge's owner and counters.
			await fake.commands.get("wechat").handler("status", ctx);
			const summary = notices.at(-1)?.message ?? "";
			expect(summary).toContain("not logged in");
			expect(summary).toContain("closed");
			expect(summary).not.toContain("peer(s)");
			expect(summary).not.toContain("owner");

			const tool = fake.tools.get("send_wechat");
			const result = await tool.execute("id", { text: "hi" }, undefined, undefined, ctx);
			expect(result.content[0].text).toContain("not started");

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("reconnects on the replacement runtime after a session switch", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			// One runtime drains its loop, so each replacement gets its own transport.
			const first = fakeWechatClient([updates([inboundText("first")])]);
			const second = fakeWechatClient([updates([inboundText("second")])]);

			// The host re-runs the factory for the new session, after shutdown.
			const before = createFakePi();
			wechat(before.pi, {
				createClient: first.createClient,
				sleep: first.sleep,
				openSession: fakePeerSession("answered before").openSession,
			});
			const beforeCtx = fakeCtx({ mode: "rpc", cwd: dir });
			await emit(before.pi, "session_start", { type: "session_start" }, beforeCtx.ctx);
			await waitFor(() => first.sent.length === 1);
			await emit(before.pi, "session_shutdown", { type: "session_shutdown" }, beforeCtx.ctx);

			const after = createFakePi();
			wechat(after.pi, {
				createClient: second.createClient,
				sleep: second.sleep,
				openSession: fakePeerSession("reconnected").openSession,
			});
			const afterCtx = fakeCtx({ mode: "rpc", cwd: dir });
			await emit(after.pi, "session_start", { type: "session_start" }, afterCtx.ctx);

			expect(first.sent[0]?.text).toBe("answered before");
			expect(first.clients()).toBe(1);
			expect(second.clients()).toBe(1);

			// The new runtime answers in its own peer session, not the host's.
			await waitFor(() => second.sent.length === 1);
			expect(second.sent[0]?.text).toBe("reconnected");
			expect(after.sentMessages).toEqual([]);

			await emit(after.pi, "session_shutdown", { type: "session_shutdown" }, afterCtx.ctx);
		});
	});
});
