import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import {
	account,
	controllableClient,
	encrypt,
	inbound,
	inboundFile,
	inboundImage,
	inboundImageWithKey,
	inboundWithId,
	makeClient,
	makeDeps,
	owner,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { type BridgeState, createBridge, isAllowedPeer, isInboundMessage } from "./bridge.ts";
import type { WechatClient } from "./transport/client.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { BotCredentials, UpdatesResponse, WechatState } from "./types.ts";

describe("message identity", () => {
	test("accepts the owner and explicit peers only", () => {
		expect(isAllowedPeer("owner", "owner", [])).toBe(true);
		expect(isAllowedPeer("friend", "owner", ["friend"])).toBe(true);
		expect(isAllowedPeer("stranger", "owner", ["friend"])).toBe(false);
	});

	test("accepts either id form after normalizing case and the suffix", () => {
		// The control screen shows the label without the suffix, so a config entry
		// copied from it has to match a message that carries the suffix.
		expect(isAllowedPeer("alice@im.wechat", "owner@im.wechat", ["alice"])).toBe(true);
		expect(isAllowedPeer("alice", "owner@im.wechat", ["alice@im.wechat"])).toBe(true);
		expect(isAllowedPeer("alice@im.wechat", "owner", [" ALICE@im.wechat "])).toBe(true);
		expect(isAllowedPeer("alice@im.wechat", "owner", ["alicia"])).toBe(false);
	});

	test("rejects the bot echo and a message without a sender", () => {
		expect(isInboundMessage({ from_user_id: "u", message_type: 1 })).toBe(true);
		expect(isInboundMessage({ from_user_id: "u", message_type: 2 })).toBe(false);
		expect(isInboundMessage({ message_type: 1 })).toBe(false);
	});
});

describe("bridge lifecycle", () => {
	test("refuses to open without credentials", () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { loadAccount: () => undefined });
		const bridge = createBridge(deps);
		expect(() => bridge.open()).toThrow("Not logged in");
	});

	test("refuses to open when another runtime holds the poller lock", () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { acquireLock: () => false });
		const bridge = createBridge(deps);
		expect(() => bridge.open()).toThrow("Another Pi session");
	});

	test("reuses the running bridge instead of starting a second poller", () => {
		const { client } = makeClient([]);
		let built = 0;
		const { deps } = makeDeps(client, {
			createClient: () => {
				built += 1;
				return client;
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		bridge.open();
		expect(built).toBe(1);
		void bridge.close();
	});

	test("claims the owner on the first open", () => {
		const { client } = makeClient([]);
		const { deps, saved } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		expect(saved.at(-1)?.ownerId).toBe(owner);
		void bridge.close();
	});

	test("starts empty state for a different account than the stored one", () => {
		// `state.json` outlives `credentials.json`: after a logout and a login as
		// another account, the old owner, cursor, and tokens must not be reused, or
		// the new account's own sender would be refused.
		const { client } = makeClient([]);
		const { deps, saved } = makeDeps(client, {
			loadState: () => ({
				cursor: "old-cursor",
				ownerId: "previous@im.wechat",
				peers: { "previous@im.wechat": { lastSeen: 1, lastContextToken: "old" } },
			}),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(saved.at(-1)).toEqual({ cursor: "", ownerId: owner, peers: {} });
		expect(bridge.status().owner).toBe(owner);
		void bridge.close();
	});

	test("keeps the stored state when the account id form changes", () => {
		// The same person reported with and without the suffix must not be treated as
		// a different account, or a re-login would drop the cursor and tokens.
		const stored = { cursor: "c", ownerId: "owner", peers: { owner: { lastSeen: 1 } } };
		const { client } = makeClient([]);
		const { deps, saved } = makeDeps(client, {
			loadAccount: () => ({ ...account, ilinkUserId: "owner@im.wechat" }),
			loadState: () => structuredClone(stored),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(saved).toEqual([]);
		expect(bridge.status().peerCount).toBe(1);
		void bridge.close();
	});

	test("keeps the stored state for the same account", () => {
		const stored = { cursor: "c", ownerId: owner, peers: { [owner]: { lastSeen: 1 } } };
		const { client } = makeClient([]);
		const { deps, saved } = makeDeps(client, { loadState: () => structuredClone(stored) });
		const bridge = createBridge(deps);
		bridge.open();
		// The cursor is the server's place in a matched account; resetting it would
		// replay or skip messages.
		expect(saved).toEqual([]);
		expect(bridge.status().peerCount).toBe(1);
		void bridge.close();
	});

	test("close releases the lock and reopens cleanly", async () => {
		const { client } = makeClient([]);
		const { deps, released } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await bridge.close();
		expect(released.count).toBe(1);
		expect(bridge.status().open).toBe(false);
		bridge.open();
		expect(bridge.status().open).toBe(true);
		await bridge.close();
	});

	test("shutdown is idempotent and can be followed by a clean open", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await bridge.shutdown();
		await bridge.shutdown();
		expect(bridge.status()).toMatchObject({ open: false, expired: false, paused: false });
		bridge.open();
		expect(bridge.status().open).toBe(true);
		await bridge.close();
	});

	test("pauses polling, releases the lock, and resumes", async () => {
		const { client, calls } = makeClient([updates([inbound("ping")])]);
		const states: BridgeState[] = [];
		let acquired = 0;
		const { deps, released } = makeDeps(client, {
			onStateChange: (state) => states.push(state),
			acquireLock: () => {
				acquired += 1;
				return true;
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().peerStates.length === 1);
		expect(await bridge.pause()).toBe(true);
		expect(bridge.status()).toMatchObject({ open: false, paused: true });
		expect(released.count).toBe(1);
		expect(states).toEqual(["running", "paused"]);
		expect(await bridge.pause()).toBe(false);

		const pollsBefore = calls.polls;
		expect(await bridge.resume()).toBe(true);
		expect(bridge.status()).toMatchObject({ open: true, paused: false });
		await waitFor(() => calls.polls > pollsBefore);
		expect(acquired).toBe(2);
		expect(states).toEqual(["running", "paused", "running"]);
		await bridge.close();
		expect(states).toEqual(["running", "paused", "running", "stopped"]);
	});

	test("refuses to resume when another runtime took the lock", async () => {
		const { client } = makeClient([]);
		let acquired = 0;
		const { deps } = makeDeps(client, {
			acquireLock: () => {
				acquired += 1;
				return acquired === 1;
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.pause()).toBe(true);
		expect(await bridge.resume()).toBe(false);
		expect(bridge.status()).toMatchObject({ open: false, paused: true });
		await bridge.close();
	});

	test("serializes a quick pause and resume", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		const paused = bridge.pause();
		const resumed = bridge.resume();
		expect(await paused).toBe(true);
		expect(await resumed).toBe(true);
		expect(bridge.status()).toMatchObject({ open: true, paused: false });
		await bridge.close();
	});

	test("resume is a no-op when the bridge was never paused", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.resume()).toBe(false);
		await bridge.close();
	});

	test("pausing keeps a running turn and withdraws its prompt", async () => {
		const { client, sent } = makeClient([updates([inbound("work")])]);
		const { deps, peers, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "confirm", title: "Proceed?" });
		expect(await bridge.pause()).toBe(true);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)?.text).toBe("That question was withdrawn.");
		expect(peers[0]?.disposed()).toBe(0);

		peers[0]?.release("finished after pause");
		await waitFor(() => sent.some((item) => item.text === "finished after pause"));
		await bridge.close();
		expect(peers[0]?.disposed()).toBe(1);
	});

	test("reports the expiry and stops polling when the session expires", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		const states: BridgeState[] = [];
		const { deps } = makeDeps(client, { onStateChange: (state) => states.push(state) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().expired);
		expect(states).toEqual(["running", "expired"]);
		expect(bridge.status()).toMatchObject({ open: false, expired: true });
		await bridge.close();
	});

	test("clears the expired state when the bridge reopens", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		const states: BridgeState[] = [];
		const { deps } = makeDeps(client, { onStateChange: (state) => states.push(state) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().expired);
		bridge.open();
		expect(bridge.status()).toMatchObject({ open: true, expired: false });
		expect(states).toEqual(["running", "expired", "running"]);
		await bridge.close();
	});

	test("clears the expired state when explicitly closed", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		const states: BridgeState[] = [];
		const { deps } = makeDeps(client, { onStateChange: (state) => states.push(state) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().expired);
		await bridge.close();
		expect(states).toEqual(["running", "expired", "stopped"]);
		expect(bridge.status().expired).toBe(false);
	});

	test("a reopen after an expiry releases the old worker's sessions", async () => {
		const { client } = makeClient([
			updates([inbound("hi")]),
			{ ret: 0, errcode: -14, msgs: [], buf: "" },
			updates([inbound("again")]),
		]);
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => peers.length === 1 && (peers[0]?.prompts.length ?? 0) === 1);
		await waitFor(() => bridge.status().expired);

		// The turn was still running when the token expired. Reopening replaces the
		// worker, so the old session must be disposed and the old loop must not wake.
		bridge.open();
		await waitFor(() => peers[0]?.disposed() === 1);
		expect(bridge.status().open).toBe(true);

		// The new connection serves the next message with a fresh session.
		await waitFor(() => peers.length === 2 && (peers[1]?.prompts.length ?? 0) === 1);
		expect(peers[1]?.prompts[0]?.text).toBe("again");
		await bridge.close();
	});

	test("resets per-connection counters on reopen", async () => {
		// The expiry path reopens without a close; that open must start a fresh
		// window, since the status documents the counters as "since the bridge opened".
		const { client } = makeClient([
			updates([inbound("hi", "stranger@im.wechat")]),
			{ ret: 0, errcode: -14, msgs: [], buf: "" },
		]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 1 && bridge.status().expired);
		bridge.open();
		expect(bridge.status().refused).toBe(0);
		await bridge.close();
	});
});

describe("bridge admission", () => {
	test("answers an inbound message through the peer's session", async () => {
		const { client, sent } = makeClient([updates([inbound("ping")])]);
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => peers.length === 1 && peers[0].prompts.length === 1);
		expect(peers[0]?.prompts[0]?.text).toBe("ping");
		expect(bridge.status().peerStates[0]?.state.sessionAgeMs).toBe(0);

		peers[0]?.release("pong");
		await waitFor(() => sent.length === 1);
		expect(sent[0]).toEqual({ to: owner, text: "pong", contextToken: "ctx" });
		await bridge.close();
	});

	test("gives each admitted peer its own session", async () => {
		const other = "friend@im.wechat";
		const { client } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, peers } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] } },
			{ answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => peers.length === 2);
		await waitFor(() => peers.every((peer) => peer.prompts.length === 1));
		expect(peers.map((peer) => peer.prompts[0]?.text).sort()).toEqual(["mine", "theirs"]);
		await bridge.close();
	});

	test("refuses and names a non-owner sender once", async () => {
		const notifications: string[] = [];
		const { client } = makeClient([
			updates([inbound("hi", "stranger@im.wechat"), inbound("again", "stranger@im.wechat")]),
		]);
		const { deps, injected } = makeDeps(client, { notify: (message) => notifications.push(message) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 2);
		expect(injected).toEqual([]);
		const named = notifications.filter((message) => message.includes("refused a message from stranger"));
		expect(named).toHaveLength(1);
		expect(named[0]).toContain("allowedPeers");
		await bridge.close();
	});

	test("refuses a turn beyond the hourly cap", async () => {
		const { client, sent } = makeClient([updates([inbound("one"), inbound("two")])]);
		const { deps } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxTurnsPerHour: 1 } }, { answers: ["pong"] });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 2);
		expect(sent.some((message) => message.text === "pong")).toBe(true);
		const limits = sent.filter((message) => message.text.includes("message limit"));
		expect(limits).toHaveLength(1);
		await bridge.close();
	});

	test("caps a burst of media messages by reserving slots before the download", async () => {
		const images = Array.from({ length: 10 }, () => inboundImage());
		const { client, sent } = makeClient([updates(images)], {
			media: Object.fromEntries(images.map(() => ["https://cdn/i", encrypt(Buffer.from([0x89, 0x50, 0x4e, 0x47]))])),
		});
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => peers.length === 1 && (peers[0]?.prompts.length ?? 0) === 1);

		// The burst is bounded by the cap, not by the batch size; the rest get one line.
		await waitFor(() => bridge.status().queued >= 7);
		await waitFor(() => sent.length === 1);
		expect(bridge.status().queued).toBeLessThanOrEqual(8);
		expect(sent[0]?.text).toBe("Too many messages queued — please wait a moment.");
		await settle();
		expect(sent).toHaveLength(1);
		await bridge.close();
	});

	test("answers a replayed message id once", async () => {
		const { client } = makeClient([updates([inboundWithId("hi", 42), inboundWithId("hi", 42)])]);
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await settle();
		expect(injected).toHaveLength(1);
		await bridge.close();
	});

	test("remembers a handled message id across a reopen", async () => {
		const first = makeClient([updates([inboundWithId("hi", 7)])]);
		const saved: WechatState[] = [];
		const { deps, injected } = makeDeps(
			first.client,
			{ saveState: (state) => saved.push(structuredClone(state)) },
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await bridge.close();

		const second = makeClient([updates([inboundWithId("hi", 7)])]);
		const reopened = makeDeps(
			second.client,
			{ loadState: () => structuredClone(saved.at(-1) as WechatState) },
			{ hold: true },
		);
		const bridge2 = createBridge(reopened.deps);
		bridge2.open();
		await settle();
		await settle();
		// The replay died on the persisted id, so no peer session was opened.
		expect(reopened.injected).toEqual([]);
		await bridge2.close();
	});

	test("truncates an oversized message and marks it", async () => {
		const long = "x".repeat(1200);
		const { client } = makeClient([updates([inbound(long)])]);
		const notifications: string[] = [];
		const { deps, injected } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, maxInboundChars: 1000 },
				notify: (message) => notifications.push(message),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toContain("[WeChat message truncated: showing 1000 of 1200 characters]");
		expect(injected[0]?.startsWith("x".repeat(1000))).toBe(true);
		expect(notifications.some((message) => message.includes("truncated to 1000 characters"))).toBe(true);
		await bridge.close();
	});

	test("reports each peer's conversation state for the control screen", async () => {
		const other = "friend@im.wechat";
		const { client } = makeClient([updates([inbound("mine"), inbound("theirs", other), inbound("more", other)])]);
		const { deps } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] } },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().peerStates.length === 2);

		// Both peers run at once now; the extra message waits its own peer's turn.
		const states = bridge.status().peerStates;
		expect(states.find((entry) => entry.peer === owner)?.state).toMatchObject({ status: "running" });
		expect(states.find((entry) => entry.peer === other)?.state).toMatchObject({ status: "running", queued: 1 });
		await bridge.close();
	});
});

describe("bridge inbound media", () => {
	test("downloads, decrypts, and injects an image as content", async () => {
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const { client } = makeClient([updates([inboundImage()])], { media: { "https://cdn/i": encrypt(plain) } });
		const { deps, peers } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		expect(peers[0]?.prompts[0]).toEqual({
			text: "",
			images: [{ type: "image", data: plain.toString("base64"), mimeType: "image/png" }],
		});
		await bridge.close();
	});

	test("saves an inbound file and references its path", async () => {
		const plain = Buffer.from("file contents");
		const mediaDir = tempDir("wechat-files-");
		const { client } = makeClient([updates([inboundFile()])], { media: { "https://cdn/f": encrypt(plain) } });
		const { deps, injected } = makeDeps(client, { mediaDir: () => mediaDir });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		const prefix = "[WeChat file: notes.txt saved to ";
		expect(injected[0]?.startsWith(prefix)).toBe(true);
		const path = (injected[0] ?? "").slice(prefix.length).replace(/\]$/, "");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path)).toEqual(plain);
		await bridge.close();
	});

	test("keeps the text turn when media decryption fails", async () => {
		const bad = inbound("look");
		bad.item_list = [...(bad.item_list ?? []), ...(inboundImageWithKey(owner, "0".repeat(32)).item_list ?? [])];
		const { client } = makeClient([updates([bad])], { media: { "https://cdn/i": new Uint8Array([1, 2, 3]) } });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		// The model is told the image was skipped instead of assuming it saw it.
		expect(injected[0]).toBe("look\n[WeChat media skipped: 1]");
		await waitFor(() => bridge.status().mediaDropped === 1);
		await bridge.close();
	});

	test("drops media over the size cap", async () => {
		const big = inbound("big");
		big.item_list = [...(big.item_list ?? []), ...(inboundImage().item_list ?? [])];
		const { client } = makeClient([updates([big])], { media: { "https://cdn/i": new Uint8Array(10) } });
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxMediaBytes: 4 } });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("big\n[WeChat media skipped: 1]");
		await waitFor(() => bridge.status().mediaDropped === 1);
		await bridge.close();
	});

	test("answers a peer whose only attachment could not be read", async () => {
		const { client, sent } = makeClient([updates([inboundImage()])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("Couldn't open 1 attachment(s) — please resend or describe it.");
		// Nothing readable means no turn: the model is not asked about a photo it
		// never received.
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("opens the reply with the media notice", async () => {
		const mixed = inbound("look");
		mixed.item_list = [...(mixed.item_list ?? []), ...(inboundImage().item_list ?? [])];
		const { client, sent } = makeClient([updates([mixed])]);
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		peers[0]?.release("it is a cat");
		await waitFor(() => sent.length === 1);
		// One bubble: the failed attachment rides on the answer.
		expect(sent[0]?.text).toBe("Couldn't open 1 attachment(s) — please resend or describe it.\n\nit is a cat");
		await bridge.close();
	});

	test("answers a voice note the server gave no transcript for", async () => {
		const voice = inbound("");
		voice.item_list = [{ type: 3, voice_item: { media: { full_url: "https://cdn/v" } } }];
		const { client, sent } = makeClient([updates([voice])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("Voice without a transcript and video aren't supported");
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("answers a video with a notice instead of silence", async () => {
		const video = inbound("");
		video.item_list = [{ type: 5, video_item: { media: { full_url: "https://cdn/v" } } }];
		const { client, sent } = makeClient([updates([video])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("aren't supported");
		expect(injected).toEqual([]);
		await bridge.close();
	});
});

describe("bridge slash commands", () => {
	test("answers /history from the peer's own session", async () => {
		const { client, sent } = makeClient([updates([inbound("/history")])]);
		const { deps } = makeDeps(client, { readHistory: async (peer, count) => `${peer} ${count}\nYou: hi` });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("You: hi");
		await bridge.close();
	});

	test("expands a snippet command into the injected turn", async () => {
		const { client } = makeClient([updates([inbound("/sum extra")])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: [{ name: "sum", summary: "s", kind: "snippet", snippet: "Summarize." }],
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("Summarize.\n\nextra");
		await bridge.close();
	});

	test("runs an action and replies without injecting a turn", async () => {
		const calls: string[] = [];
		const { client, sent } = makeClient([updates([inbound("/hi a b")])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: [
				{
					name: "hi",
					summary: "s",
					kind: "action",
					run: async (ctx) => {
						calls.push(ctx.args);
						await ctx.reply("hello there");
					},
				},
			],
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(calls).toEqual(["a b"]);
		expect(injected).toEqual([]);
		expect(sent[0]).toMatchObject({ to: owner, text: "hello there" });
		await bridge.close();
	});

	test("ignores an owner-only command from a non-owner peer", async () => {
		const calls: string[] = [];
		const peer = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("/new", peer)])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: [
				{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
			],
			config: { ...DEFAULT_CONFIG, allowedPeers: [peer] },
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 1);
		expect(calls).toEqual([]);
		expect(injected).toEqual([]);
		expect(sent).toEqual([]);
		await bridge.close();
	});

	test("accepts an owner-only command from the owner in either id form", async () => {
		// Admission normalizes the `@im.wechat` suffix, so the owner check must too:
		// a message that carries the suffix reaches an owner stored without it.
		const calls: string[] = [];
		const { client } = makeClient([updates([inbound("/new", "boss@im.wechat")])]);
		const { deps } = makeDeps(client, {
			slashCommands: [
				{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
			],
			loadAccount: () => ({ ...account, ilinkUserId: "boss" }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => calls.length === 1);
		expect(calls).toEqual(["ran"]);
		expect(bridge.status().refused).toBe(0);
		await bridge.close();
	});

	test("passes an unknown slash command through as a normal turn", async () => {
		const { client } = makeClient([updates([inbound("/nope")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("/nope");
		await bridge.close();
	});

	test("does not intercept a command carrying media", async () => {
		const mixed = inbound("look");
		mixed.item_list = [{ type: 1, text_item: { text: "/new" } }, ...(inboundImage().item_list ?? [])];
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const { client } = makeClient([updates([mixed])], { media: { "https://cdn/i": encrypt(plain) } });
		const calls: string[] = [];
		const { deps, peers } = makeDeps(client, {
			slashCommands: [
				{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
			],
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		expect(peers[0]?.prompts[0]).toMatchObject({ text: "/new" });
		expect(calls).toEqual([]);
		await bridge.close();
	});

	test("declines /new while a run is in flight", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		deliver(inbound("/new"));
		await waitFor(() => sent.length >= 1);
		expect(sent[0]?.text).toContain("send /new again");
		// The session was not replaced under the run.
		expect(bridge.reset(owner)).toBe(false);
		await bridge.close();
	});

	test("/status reports the dialog a blocked turn is waiting on", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "confirm", title: "Proceed?" });
		deliver(inbound("/status"));
		// The command reached its handler instead of being parsed as an answer.
		await waitFor(() => sent.some((item) => item.text.includes("Proceed?")));
		expect(sent.some((item) => item.text.includes("didn't recognize"))).toBe(false);
		expect(bridge.channel(owner).hasPending()).toBe(true);

		bridge.channel(owner).cancel();
		expect(await answer).toEqual({ kind: "cancelled" });
		await bridge.close();
	});

	test("/stop stops a blocked turn instead of answering its dialog", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "confirm", title: "Proceed?" });
		deliver(inbound("/stop"));
		await waitFor(() => sent.some((item) => item.text === "Stopped."));
		// Only the tool's own signal settles the dialog; the command stops the turn.
		expect(bridge.channel(owner).hasPending()).toBe(true);

		bridge.channel(owner).reset();
		expect(await answer).toEqual({ kind: "cancelled" });
		await bridge.close();
	});

	test("a plain number still answers the dialog", async () => {
		const { client, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "select", title: "Pick", options: ["A", "B"] });
		deliver(inbound("1"));
		expect(await answer).toEqual({ kind: "value", value: "A" });
		await bridge.close();
	});

	test("starts a fresh conversation on /new when nothing is running", async () => {
		const { client, sent } = makeClient([updates([inbound("/new")])]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("Starting a new session");
		expect(bridge.peerState(owner)).toEqual({ status: "idle", queued: 0 });
		await bridge.close();
	});
});

describe("bridge delivery", () => {
	test("sets typing before a turn and cancels it when the turn stops", async () => {
		const { client, typing } = makeClient([updates([inbound("ping")])]);
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await waitFor(() => typing.length >= 1);
		expect(typing[0]).toEqual({ ilinkUserId: owner, typing: true });

		await bridge.stop(owner);
		await waitFor(() => typing.some((call) => call.typing === false));
		expect(typing.at(-1)).toEqual({ ilinkUserId: owner, typing: false });
		await bridge.close();
	});

	test("does not call sendTyping without a ticket", async () => {
		const { client, typing } = makeClient([updates([inbound("ping")])], { noTicket: true });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(typing).toEqual([]);
		await bridge.close();
	});

	test("answers in the peer's language", async () => {
		const { client, sent } = makeClient([updates([inbound("你好")])]);
		const { deps } = makeDeps(client, {}, { answers: [""] });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		// A turn with no text says so in the peer's language, not in English.
		expect(sent[0]?.text).toBe("这条处理完了，但没有文字输出。");
		await bridge.close();
	});

	test("keeps that language when the peer replies with a bare number", async () => {
		// "1" is language-neutral, so it must not be read as evidence of English and
		// switch every later notice for this peer.
		const { client, sent } = makeClient([updates([inbound("你好")]), updates([inbound("1")])]);
		const { deps } = makeDeps(client, {}, { answers: ["", ""] });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 2);
		expect(sent.map((item) => item.text)).toEqual(["这条处理完了，但没有文字输出。", "这条处理完了，但没有文字输出。"]);
		await bridge.close();
	});

	test("reports how much of a split reply went out when a chunk fails", async () => {
		const sent: string[] = [];
		const notifications: string[] = [];
		let calls = 0;
		const script: UpdatesResponse[] = [updates([inbound("ping")])];
		const client = {
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				const next = script.shift();
				if (next) return next;
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
			sendMessage: async (_account: BotCredentials, args: { text: string }) => {
				calls += 1;
				if (calls === 2) throw new Error("socket hang up");
				sent.push(args.text);
				return { ret: 0 };
			},
			getConfig: async () => ({ ret: 0 }),
			sendTyping: async () => ({ ret: 0 }),
			downloadCdn: async () => new Uint8Array(),
		} as unknown as WechatClient;
		const { deps, peers } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, maxReplyChars: 4 },
				notify: (message) => notifications.push(message),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		peers[0]?.release("abcdefgh");
		await waitFor(() => notifications.length === 1);
		expect(sent).toEqual(["[1/2] abcd"]);
		expect(notifications[0]).toContain("after 1 of 2 parts were sent");
		await bridge.close();
	});

	test("reports one rejected reply, forgets the token, and does not retry parts", async () => {
		const notifications: string[] = [];
		const base = makeClient([updates([inbound("q")])]);
		let sends = 0;
		const client = {
			...base.client,
			sendMessage: async () => {
				sends += 1;
				return { ret: -2, errmsg: "context token invalid" };
			},
		} as unknown as WechatClient;
		const { deps, saved } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, maxReplyChars: 4 },
				notify: (message) => notifications.push(message),
				// The token is stored under the un-suffixed form while the message comes
				// from the suffixed one, so forgetting it exercises the id normalization.
				loadAccount: () => ({ ...account, ilinkUserId: "owner" }),
				loadState: () => ({ cursor: "", peers: { owner: { lastContextToken: "old", lastSeen: 0 } } }),
			},
			{ answers: ["abcdefgh"] },
		);
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => notifications.length === 1);
		// The server's own words are in the notice; it is reported once, not per part.
		expect(notifications[0]).toContain("ret -2");
		expect(notifications[0]).toContain("context token invalid");
		expect(notifications[0]).toContain("after 0 of 2 parts");
		// The first part failed, so the second was never attempted.
		expect(sends).toBe(1);
		// A rejected token is forgotten; the next inbound message replaces it, and the
		// two id forms still share one entry.
		expect(saved.at(-1)?.peers.owner?.lastContextToken).toBeUndefined();
		expect(Object.keys(saved.at(-1)?.peers ?? {})).toEqual(["owner"]);
		await bridge.close();
	});

	test("reports the configured poll hold and the doctor telemetry", async () => {
		const { client } = makeClient([updates([])]);
		const { deps } = makeDeps(client, {
			config: { ...DEFAULT_CONFIG, pollHoldMs: 5000 },
			now: () => 5000,
			loadLock: () => ({ pid: 7, at: 1000 }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().lastPollAt !== undefined);
		const status = bridge.status();
		expect(status.startedAt).toBe(5000);
		expect(status.tokenCreatedAt).toBe(account.createdAt);
		expect(status.lock).toEqual({ pid: 7, at: 1000 });
		expect(status.pollHoldMs).toBe(5000);
		await bridge.close();
	});

	test("passes a configured poll hold to the transport", async () => {
		const holds: Array<number | undefined> = [];
		const base = makeClient([]);
		const client = {
			...base.client,
			getUpdates: async (
				_account: BotCredentials,
				_cursor: string,
				signal?: AbortSignal,
				options?: { holdMs?: number },
			): Promise<UpdatesResponse> => {
				holds.push(options?.holdMs);
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const { deps } = makeDeps(client, { config: { ...DEFAULT_CONFIG, pollHoldMs: 3000 } });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => holds.length >= 1);
		expect(holds[0]).toBe(3000);
		await bridge.close();
	});

	test("records the last rejected poll", async () => {
		let first = true;
		const base = makeClient([]);
		const client = {
			...base.client,
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				if (first) {
					first = false;
					return { ret: -1, msgs: [], buf: "" };
				}
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const { deps } = makeDeps(client, { pollTimeout: () => 10 });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().lastPollError !== undefined);
		expect(bridge.status().lastPollError).toContain("rejected ret -1");
		await bridge.close();
	});
});

describe("bridge sendToOwner", () => {
	test("messages the owner using the stored reply token", async () => {
		const { client, sent } = makeClient([]);
		const { deps } = makeDeps(client, {
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.sendToOwner("hello")).toEqual({ ok: true });
		expect(sent[0]).toEqual({ to: owner, text: "hello", contextToken: "ctx" });
		expect(bridge.status().lastSendError).toBeUndefined();
		await bridge.close();
	});

	test("finds the reply token when the owner and the stored peer differ in id form", async () => {
		const { client, sent } = makeClient([]);
		const { deps } = makeDeps(client, {
			// The owner id comes from the login response; the token was recorded from
			// a `from_user_id` that carries the suffix.
			loadAccount: () => ({ ...account, ilinkUserId: "boss" }),
			loadState: () => ({ cursor: "", peers: { "boss@im.wechat": { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.sendToOwner("hello")).toEqual({ ok: true });
		expect(sent[0]).toMatchObject({ to: "boss", contextToken: "ctx" });
		await bridge.close();
	});

	test("falls back to the stored token for an inbound message without one", async () => {
		// The sender form differs from the stored key on purpose: the fallback must
		// find the token recorded under the other form.
		const message = { ...inbound("ping", "owner"), context_token: undefined };
		const { client, sent } = makeClient([updates([message])]);
		const { deps, peers } = makeDeps(
			client,
			{
				loadAccount: () => ({ ...account, ilinkUserId: "owner" }),
				loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "old", lastSeen: 0 } } }),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => peers.length === 1 && peers[0].prompts.length === 1);
		peers[0]?.release("pong");
		await waitFor(() => sent.length === 1);
		expect(sent[0]).toMatchObject({ to: "owner", text: "pong", contextToken: "old" });
		await bridge.close();
	});

	test("fails when the bridge is not started", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		expect(await bridge.sendToOwner("hello")).toEqual({ ok: false, error: "WeChat bridge is not started." });
	});

	test("refuses to repeat the answer of the turn in flight", async () => {
		const { client, sent } = makeClient([updates([inbound("hi")])]);
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		// The owner is mid-turn; a tool send now would deliver the answer twice.
		expect(await bridge.sendToOwner("hi back")).toEqual({
			ok: false,
			error: "The bridge replies to this turn automatically; do not repeat it.",
		});
		expect(sent).toEqual([]);
		await bridge.close();
	});

	test("sends one image to the owner as a picture", async () => {
		const { client, sentImages } = controllableClient();
		const { deps } = makeDeps(client, {
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();

		const path = join(tempDir("wechat-bridge-image-"), "plot.png");
		writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
		expect(await bridge.sendToOwner(undefined, path)).toEqual({ ok: true });
		// An image item carries the padded size and the key, and no file name.
		expect(sentImages[0]).toMatchObject({ to: owner, contextToken: "ctx" });
		expect(sentImages[0]?.midSize).toBeGreaterThan(0);
		await bridge.close();
	});

	test("sends an image while the owner's turn runs, though text is refused", async () => {
		const { client, sentImages } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-image-"), "plot.png");
		writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
		// The bridge cannot produce an image, so an image cannot duplicate the answer.
		expect(await bridge.sendToOwner(undefined, path)).toEqual({ ok: true });
		expect(sentImages).toHaveLength(1);
		expect(await bridge.sendToOwner("hi back")).toMatchObject({ ok: false });
		await bridge.close();
	});

	test("reports an image the owner cannot receive, once", async () => {
		const notifications: string[] = [];
		const { client } = controllableClient();
		const failing = {
			...client,
			sendImageMessage: async () => {
				throw new Error("network down");
			},
		} as unknown as WechatClient;
		const { deps } = makeDeps(failing, {
			notify: (message) => notifications.push(message),
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();

		const path = join(tempDir("wechat-bridge-image-"), "plot.png");
		writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
		const result = await bridge.sendToOwner(undefined, path);
		expect(result.ok).toBe(false);
		expect(notifications.filter((message) => message.includes("image delivery failed"))).toHaveLength(1);
		await bridge.close();
	});

	test("still messages the owner while another peer's turn runs", async () => {
		const other = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("hi", other)])]);
		const { deps, injected } = makeDeps(
			client,
			{
				config: { ...DEFAULT_CONFIG, allowedPeers: [other] },
				loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
			},
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		expect(await bridge.sendToOwner("note to self")).toEqual({ ok: true });
		expect(sent[0]).toMatchObject({ to: owner, text: "note to self" });
		await bridge.close();
	});

	test("reports a rejected send instead of claiming delivery", async () => {
		const base = makeClient([]);
		const client = {
			...base.client,
			sendMessage: async () => ({ ret: -2, errmsg: "context token invalid" }),
		} as unknown as WechatClient;
		const { deps } = makeDeps(client, {
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		const result = await bridge.sendToOwner("hello");
		expect(result).toEqual({ ok: false, error: "Weixin rejected the message (ret -2: context token invalid)." });
		expect(bridge.status().lastSendError).toContain("rejected");
		await bridge.close();
	});

	test("reports the errcode when ret is zero", async () => {
		const base = makeClient([]);
		const client = {
			...base.client,
			sendMessage: async () => ({ ret: 0, errcode: -2, errmsg: "context token invalid" }),
		} as unknown as WechatClient;
		const { deps } = makeDeps(client, {
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		// Reporting `ret 0` would hide the actual reason.
		expect(await bridge.sendToOwner("hello")).toEqual({
			ok: false,
			error: "Weixin rejected the message (ret -2: context token invalid).",
		});
		await bridge.close();
	});

	test("flattens Markdown and numbers split parts", async () => {
		const { client, sent } = makeClient([]);
		const { deps } = makeDeps(client, {
			config: { ...DEFAULT_CONFIG, maxReplyChars: 5 },
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.sendToOwner("**abcdefgh**")).toEqual({ ok: true });
		expect(sent.map((message) => message.text)).toEqual(["[1/2] abcde", "[2/2] fgh"]);
		await bridge.close();
	});

	test("reports a message that formats down to nothing", async () => {
		const { client, sent } = makeClient([]);
		const { deps } = makeDeps(client, {
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		expect(await bridge.sendToOwner("**")).toEqual({ ok: false, error: "Nothing to send after formatting." });
		expect(sent).toEqual([]);
		await bridge.close();
	});
});

describe("bridge remote prompts", () => {
	test("sends a dialog to WeChat and consumes the reply as an answer", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "select", title: "Pick", options: ["A", "B"] });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		expect(sent[0]?.text).toContain("Pick");

		deliver(inbound("2"));
		expect(await answer).toEqual({ kind: "value", value: "B" });
		// The reply answered the prompt instead of starting a new turn.
		expect(injected.length).toBe(1);
		await bridge.close();
	});

	test("uploads and sends a file through the channel", async () => {
		const { client, sentFiles } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel(owner).postFile(path, "plan.md")).toBe(true);
		expect(sentFiles[0]).toMatchObject({ to: owner, fileName: "plan.md", len: "4" });
		await bridge.close();
	});

	test("reports a failed message preface once instead of dropping it", async () => {
		const notifications: string[] = [];
		const base = makeClient([updates([inbound("q")])]);
		const client = {
			...base.client,
			sendMessage: async () => ({ ret: -1 }),
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(client, { notify: (message) => notifications.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		// A dialog preface (or the plan digest) that cannot be sent must not look like
		// a preface that never existed: the peer would be left with only the choices.
		await bridge.channel(owner).post("plan digest");
		await bridge.channel(owner).post("second try");
		const failures = notifications.filter((message) => message.includes("message delivery failed"));
		expect(failures).toHaveLength(1);
		await bridge.close();
	});

	test("reports a failed file preface on the terminal", async () => {
		const notifications: string[] = [];
		// `makeClient` has no upload endpoint, so the CDN upload fails like a real one.
		const { client } = makeClient([updates([inbound("q")])]);
		const { deps, injected } = makeDeps(client, { notify: (message) => notifications.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel(owner).postFile(path, "plan.md")).toBe(false);
		expect(notifications.some((message) => message.includes("file delivery failed for plan.md"))).toBe(true);
		await bridge.close();
	});

	test("reports the waiting prompt for the control screen", async () => {
		const { client } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "select", title: "Pick", options: ["A"] });
		expect(bridge.status().prompts[0]).toMatchObject({ peer: owner, kind: "select", title: "Pick" });
		bridge.channel(owner).cancel();
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(bridge.status().prompts[0]).toBeUndefined();
		await bridge.close();
	});

	test("resolves a pending prompt as cancelled when the bridge closes", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel(owner).request({ kind: "confirm", title: "Sure?" });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		await bridge.close();
		expect(await answer).toEqual({ kind: "cancelled" });
	});
});

describe("two peers at once", () => {
	const OTHER = "friend@im.wechat";

	/** Open a bridge with the owner's turn and one other peer's turn both in flight. */
	async function twoPeers() {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [OTHER] } },
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		deliver(inbound("hello", OTHER));
		await waitFor(() => injected.length === 2);
		return { bridge, sent };
	}

	test("gives each peer's dialog its own owner", async () => {
		const { bridge, sent } = await twoPeers();

		const mine = bridge.channel(owner).request({ kind: "confirm", title: "For the owner?" });
		const theirs = bridge.channel(OTHER).request({ kind: "confirm", title: "For the friend?" });
		await waitFor(() => bridge.status().prompts.length === 2);
		// Each question went to the phone that was asked.
		await waitFor(() => sent.filter((message) => message.text.includes("For the")).length === 2);
		expect(sent.some((message) => message.to === owner && message.text.includes("For the owner?"))).toBe(true);
		expect(sent.some((message) => message.to === OTHER && message.text.includes("For the friend?"))).toBe(true);

		// Each reply answers its own peer's prompt and leaves the other waiting.
		expect(bridge.channel(owner).handleInbound("yes")).toBe(true);
		expect(await mine).toEqual({ kind: "confirmed", confirmed: true });
		expect(bridge.status().prompts.map((prompt) => prompt.peer)).toEqual([OTHER]);

		expect(bridge.channel(OTHER).handleInbound("no")).toBe(true);
		expect(await theirs).toEqual({ kind: "confirmed", confirmed: false });
		expect(bridge.status().prompts).toEqual([]);
		await bridge.close();
	});

	test("aborting one peer's dialog leaves the other's waiting", async () => {
		const { bridge } = await twoPeers();
		const controller = new AbortController();
		const mine = bridge.channel(owner).request({ kind: "confirm", title: "For the owner?" }, controller.signal);
		const theirs = bridge.channel(OTHER).request({ kind: "select", title: "For the friend?", options: ["A"] });
		await waitFor(() => bridge.status().prompts.length === 2);

		controller.abort();
		expect(await mine).toEqual({ kind: "cancelled" });
		expect(bridge.channel(OTHER).hasPending()).toBe(true);
		expect(bridge.channel(OTHER).handleInbound("1")).toBe(true);
		expect(await theirs).toEqual({ kind: "value", value: "A" });
		await bridge.close();
	});
});

describe("abandoned turns", () => {
	const NOTICE = "The session stopped before this answer finished — send it again when it's back.";

	test("tells the peer when a close cuts its turn off", async () => {
		// `respectSignal` makes the transport refuse an already-aborted send, as `fetch`
		// does, so a notice that inherited the poll's controller would be lost here.
		const { client, sent } = controllableClient({ respectSignal: true });
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.close();
		expect(sent.map((message) => message.text)).toEqual([NOTICE]);
	});

	test("says nothing once the answer has arrived", async () => {
		const { client, sent } = controllableClient({ respectSignal: true });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await waitFor(() => sent.length === 1);

		await bridge.close();
		expect(sent.map((message) => message.text)).toEqual(["pong"]);
	});

	test("reports an abandon notice the transport could not deliver, once", async () => {
		const { client } = controllableClient();
		const notices: string[] = [];
		const failing = {
			...client,
			sendMessage: async () => {
				throw new Error("network down");
			},
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(failing, { notify: (message) => notices.push(message) }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.close();
		expect(notices.filter((message) => message.includes("network down"))).toHaveLength(1);
	});
});
