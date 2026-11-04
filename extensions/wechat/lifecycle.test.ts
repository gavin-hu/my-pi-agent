/**
 * The wechat bridge lifecycle: one poller per runtime, opened by hand on a session
 * that bound an account, answering inbound turns in the peer's own session, and
 * released on shutdown or stop.
 *
 * The transport, the sleep, and the peer session are the extension's own seams,
 * so the real bridge runs here without a network, a real timer, or a model.
 */

import { describe, expect, test } from "bun:test";
import { isRemoteTurn } from "../../lib/interaction.ts";
import { withAgentDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi, emit } from "../../test/helpers/fakes.ts";
import {
	ACCOUNT,
	fakeWechatClient,
	inboundText,
	startWechat,
	updates,
	wechatExtension,
	writeAccount,
} from "../../test/helpers/fixtures/wechat.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import wechat from "./index.ts";
import type { PeerSession } from "./peer/peer-session.ts";
import { BINDING_ENTRY } from "./state/binding.ts";
import { saveAccount } from "./state/credentials.ts";

describe("wechat lifecycle", () => {
	/** The branch entry `/wechat start` writes, as a resumed session replays it. */
	const bound = [{ type: "custom", customType: BINDING_ENTRY, data: { account: ACCOUNT.ilinkBotId } }];

	/** The extension over its own seams, on a context; nothing has run yet. */
	const open = wechatExtension;
	/** Start it by hand, as `/wechat start` does, and wait for its poller. */
	const start = startWechat;

	test("starts only when the command runs, and binds the branch", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx, notifications } = open(dir);
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			// A stored account is not a start: the frame opens nothing, and says so.
			expect(client.clients()).toBe(0);
			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("closed");

			await fake.commands.get("wechat").handler("start", ctx);
			expect(notifications.at(-1)).toContain("WeChat bridge started");
			await waitFor(() => client.clients() === 1);
			// The binding is on the branch, so a resume opens what this start opened.
			expect(fake.appended.at(-1)).toEqual({ customType: BINDING_ENTRY, data: { account: ACCOUNT.ilinkBotId } });

			await fake.commands.get("wechat").handler("status", ctx);
			expect(notifications.join("\n")).toContain("open");
			const tool = fake.tools.get("send_wechat");
			const result = await tool.execute("id", { text: "hi" }, undefined, undefined, ctx);
			expect(result.content[0].text).toBe("Sent to the WeChat owner.");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("opens a bound branch, and keeps one that was stopped stopped", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const resumed = open(dir, { branch: bound });
			await emit(resumed.fake.pi, "session_start", { type: "session_start" }, resumed.ctx);
			await waitFor(() => resumed.client.clients() === 1);
			await emit(resumed.fake.pi, "session_shutdown", { type: "session_shutdown" }, resumed.ctx);

			// A stop outranks the binding before it, so a resume must not reopen it.
			const stopped = [...bound, { type: "custom", customType: BINDING_ENTRY, data: { account: null } }];
			const idle = open(dir, { branch: stopped });
			await emit(idle.fake.pi, "session_start", { type: "session_start" }, idle.ctx);
			await settle();
			expect(idle.client.clients()).toBe(0);
			await emit(idle.fake.pi, "session_shutdown", { type: "session_shutdown" }, idle.ctx);
		});
	});

	test("closes the bridge a start in flight opens after the shutdown", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = open(dir, { branch: bound });

			// A session that ends before its deferred start finishes: shutdown waits for the
			// open and then closes it, so nothing is left polling a dead runtime.
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
			await waitFor(() => client.aborts() > 0);
			expect(client.clients()).toBe(1);
		});
	});

	test("a send_wechat call joins the deferred start instead of missing the bridge", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = open(dir, { branch: bound });

			// The frame is back while the start is still opening; the tool is a reader of it.
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			const tool = fake.tools.get("send_wechat");
			const result = await tool.execute("id", { text: "hello" }, undefined, undefined, ctx);
			expect(result.content[0].text).toBe("Sent to the WeChat owner.");
			expect(client.sent[0]?.text).toBe("hello");

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("keeps one poller when session_start is emitted twice", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = open(dir, { branch: bound });
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			// RPC binds the session twice on a session switch. The start is deferred, so the
			// tool is what joins it: it returns once that start has settled, which is the
			// point a second poller would have been running.
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			const tool = fake.tools.get("send_wechat");
			await tool.execute("id", { text: "hi" }, undefined, undefined, ctx);
			expect(client.clients()).toBe(1);

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("answers an inbound message in the peer's own session", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = await start(dir, { script: [updates([inboundText("hello")])] });

			// The inbound message runs in the peer's own session, so the host
			// transcript never sees it.
			await waitFor(() => client.sent.length === 1);
			expect(client.sent[0]).toMatchObject({ to: "owner@im.wechat", text: "hi from pi" });
			expect(fake.sentMessages).toEqual([]);

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("restarts a running bridge when a login replaced the account", async () => {
		await withAgentDir(async (dir) => {
			const first = { ...ACCOUNT, ilinkBotId: "bot-a", ilinkUserId: "alice@im.wechat", baseUrl: "https://a" };
			const second = { ...ACCOUNT, ilinkBotId: "bot-b", ilinkUserId: "bob@im.wechat", baseUrl: "https://b" };
			writeAccount(dir, first);
			const { fake, client, ctx } = await start(dir);
			expect(client.baseUrls()).toEqual(["https://a"]);

			// A login replaces the one stored account; the running poller still holds the
			// previous token, so a start as the new account replaces it.
			saveAccount(second);
			await fake.commands.get("wechat").handler("start", ctx);
			await waitFor(() => client.clients() === 2);
			expect(client.baseUrls()).toEqual(["https://a", "https://b"]);
			expect(fake.appended.at(-1)).toEqual({ customType: BINDING_ENTRY, data: { account: "bot-b" } });
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
				async dispose(): Promise<void> {},
			};
			wechat(fake.pi, {
				createClient: client.createClient,
				sleep: client.sleep,
				openSession: async () => ({ session, dispose: async () => {} }) as unknown as PeerSession,
			});
			const { ctx, notifications, selects } = fakeCtx({
				mode: "tui",
				cwd: dir,
				hasUI: true,
				select: "local",
				branch: bound,
			});
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

	test("stops polling on session_shutdown and leaves the binding", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx, statuses } = await start(dir);
			await waitFor(() => client.polls() >= 1);
			expect(statuses.get("wechat")).toContain("wechat");
			const polls = client.polls();
			const appended = fake.appended.length;

			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
			expect(client.aborts()).toBe(1);
			expect(client.polls()).toBe(polls);
			expect(statuses.get("wechat")).toBeUndefined();
			// A shutdown stops the poller; only a stop or a logout unbinds, so a resume
			// opens it again.
			expect(fake.appended.length).toBe(appended);

			// A second shutdown (reload, replacement, process exit) must not throw.
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("clears the bridge and the binding when the account is logged out", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx, notices } = await start(dir, { hasUI: true, confirm: true });
			await waitFor(() => client.polls() >= 1);

			await fake.commands.get("wechat").handler("logout", ctx);
			expect(client.aborts()).toBe(1);
			expect(notices.at(-1)?.message).toBe("WeChat logged out.");
			expect(fake.appended.at(-1)).toEqual({ customType: BINDING_ENTRY, data: { account: null } });

			// With no account there is nothing to report: the summary must name neither
			// the old account nor the old bridge's owner and counters.
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

	test("stops the bridge on the command and records the stop", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx, notices } = await start(dir);
			await waitFor(() => client.polls() >= 1);

			await fake.commands.get("wechat").handler("stop", ctx);
			expect(client.aborts()).toBe(1);
			expect(notices.at(-1)?.message).toBe("WeChat bridge stopped on this session.");
			expect(fake.appended.at(-1)).toEqual({ customType: BINDING_ENTRY, data: { account: null } });

			await fake.commands.get("wechat").handler("stop", ctx);
			expect(notices.at(-1)?.message).toBe("WeChat is not running on this session.");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("reconnects on the replacement runtime after a session switch", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			// One runtime drains its loop, so each replacement gets its own transport.
			const first = await start(dir, { script: [updates([inboundText("first")])], answer: "answered before" });
			await waitFor(() => first.client.sent.length === 1);
			await emit(first.fake.pi, "session_shutdown", { type: "session_shutdown" }, first.ctx);

			// The host re-runs the factory for the new session, after shutdown.
			const second = await start(dir, { script: [updates([inboundText("second")])], answer: "reconnected" });

			expect(first.client.sent[0]?.text).toBe("answered before");
			expect(first.client.clients()).toBe(1);
			expect(second.client.clients()).toBe(1);

			// The new runtime answers in its own peer session, not the host's.
			await waitFor(() => second.client.sent.length === 1);
			expect(second.client.sent[0]?.text).toBe("reconnected");
			expect(second.fake.sentMessages).toEqual([]);

			await emit(second.fake.pi, "session_shutdown", { type: "session_shutdown" }, second.ctx);
		});
	});

	test("a send_wechat call joins a hand start instead of reporting no bridge", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const { fake, client, ctx } = open(dir, {
				loadBridge: async () => {
					await held;
					return import("./bridge.ts");
				},
			});
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			const starting = fake.commands.get("wechat").handler("start", ctx);
			// The tool arrives while the hand start is still building the bridge.
			const tool = fake.tools.get("send_wechat");
			const calling = tool.execute("id", { text: "hello" }, undefined, undefined, ctx);
			release();
			const result = await calling;
			await starting;
			expect(result.content[0].text).toBe("Sent to the WeChat owner.");
			expect(client.sent[0]?.text).toBe("hello");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("a stop that lands mid-start leaves the session stopped", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			let release!: () => void;
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const { fake, ctx, notices } = open(dir, {
				loadBridge: async () => {
					await held;
					return import("./bridge.ts");
				},
			});
			await emit(fake.pi, "session_start", { type: "session_start" }, ctx);
			const starting = fake.commands.get("wechat").handler("start", ctx);
			const stopping = fake.commands.get("wechat").handler("stop", ctx);
			release();
			await Promise.all([starting, stopping]);
			// The stop is the last word: the start that a stop overtook closed what it opened,
			// and the branch records the stop rather than the binding it would have written.
			const said = notices.map((notice) => notice.message).join("\n");
			expect(said).toContain("A stop landed while WeChat was starting");
			expect(fake.appended.filter((entry) => entry.customType === BINDING_ENTRY).at(-1)?.data).toEqual({
				account: null,
			});
			// Nothing is left polling: the tool reports the bridge a stopped session has.
			const tool = fake.tools.get("send_wechat");
			const result = await tool.execute("id", { text: "hi" }, undefined, undefined, ctx);
			expect(result.content[0].text).toContain("not started");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});

	test("a tree jump closes a poller whose branch no longer binds it", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			const { fake, client, ctx } = await start(dir);
			await waitFor(() => client.polls() >= 1);

			// The jump lands on a branch that carries the stop.
			ctx.sessionManager.getBranch = () => [
				...bound,
				{ type: "custom", customType: BINDING_ENTRY, data: { account: null } },
			];
			await emit(fake.pi, "session_tree", { type: "session_tree" }, ctx);
			expect(client.aborts()).toBe(1);
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});
});
