import { describe, expect, test } from "bun:test";
import {
	account,
	encrypt,
	inbound,
	inboundImage,
	key,
	makeClient,
	makeDeps,
	owner,
	updates,
} from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { type BridgeState, createBridge, isAllowedPeer, isInboundMessage } from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { BotCredentials, UpdatesResponse } from "./types.ts";

describe("message helpers", () => {
	test("isAllowedPeer accepts the owner and explicit peers only", () => {
		expect(isAllowedPeer("owner", "owner", [])).toBe(true);
		expect(isAllowedPeer("friend", "owner", ["friend"])).toBe(true);
		expect(isAllowedPeer("stranger", "owner", ["friend"])).toBe(false);
	});

	test("isAllowedPeer accepts either id form", () => {
		// The control screen shows the label without the suffix, so a config entry
		// copied from it has to match a message that carries the suffix.
		expect(isAllowedPeer("alice@im.wechat", "owner@im.wechat", ["alice"])).toBe(true);
		expect(isAllowedPeer("alice", "owner@im.wechat", ["alice@im.wechat"])).toBe(true);
		expect(isAllowedPeer("alice@im.wechat", "owner", [" ALICE@im.wechat "])).toBe(true);
		expect(isAllowedPeer("alice@im.wechat", "owner", ["alicia"])).toBe(false);
	});

	test("isInboundMessage rejects the bot echo and messages without a sender", () => {
		expect(isInboundMessage({ from_user_id: "u", message_type: 1 })).toBe(true);
		expect(isInboundMessage({ from_user_id: "u", message_type: 2 })).toBe(false);
		expect(isInboundMessage({ message_type: 1 })).toBe(false);
	});
});

describe("bridge", () => {
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
	test("refuses a peer that is not the owner", async () => {
		const { client } = makeClient([updates([inbound("hi", "stranger@im.wechat")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 1);
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("names a refused sender once in the terminal", async () => {
		const notifications: string[] = [];
		const { client } = makeClient([
			updates([inbound("hi", "stranger@im.wechat"), inbound("again", "stranger@im.wechat")]),
		]);
		const { deps } = makeDeps(client, { notify: (message) => notifications.push(message) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().refused === 2);
		const named = notifications.filter((message) => message.includes("refused a message from stranger"));
		expect(named).toHaveLength(1);
		expect(named[0]).toContain("allowedPeers");
		await bridge.close();
	});

	test("refuses to open without credentials", () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { loadAccount: () => undefined });
		const bridge = createBridge(deps);
		expect(() => bridge.open()).toThrow();
	});

	test("reports each peer's conversation state for the control screen", async () => {
		const other = "friend@im.wechat";
		const { client } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] } },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().queued === 1);

		const states = bridge.status().peerStates;
		expect(states.find((entry) => entry.peer === owner)?.state).toMatchObject({ status: "running" });
		expect(states.find((entry) => entry.peer === other)?.state).toMatchObject({ status: "queued", queued: 1 });
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

	test("keeps media messages in arrival order even when a download is slow", async () => {
		const withImage = (text: string, url: string) => {
			const message = inbound(text);
			message.item_list = [
				...(message.item_list ?? []),
				{ type: 2, image_item: { media: { full_url: url }, aeskey: key.toString("hex") } },
			];
			return message;
		};
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		const base = makeClient(
			[
				updates([inbound("hold")]),
				updates([withImage("first", "https://cdn/1"), withImage("second", "https://cdn/2")]),
			],
			{
				media: { "https://cdn/1": encrypt(plain), "https://cdn/2": encrypt(plain) },
			},
		);
		const client = {
			...base.client,
			downloadCdn: async (ref: { full_url?: string }) => {
				// The first image is the slow one; without an arrival-order chain the
				// second would enqueue first and the merged prompt would be reversed.
				if (ref.full_url === "https://cdn/1") await settle(5);
				return encrypt(plain);
			},
		} as unknown as WechatClient;
		const { deps, peers } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);
		// Both wait behind the running turn and merge into one prompt, in order.
		await waitFor(() => bridge.status().queued === 2);

		peers[0]?.release("pong");
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 2);
		expect(peers[0]?.prompts[1]?.text).toBe("first\nsecond");
		await bridge.close();
	});

	test("stops and reports when the session expires", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().expired);
		expect(bridge.status().open).toBe(false);
		await bridge.close();
	});

	test("reports doctor telemetry after a poll", async () => {
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

	test("pausing keeps a running turn and withdraws its prompt", async () => {
		const { client, sent } = makeClient([updates([inbound("work")])]);
		const { deps, peers, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "confirm", title: "Proceed?" });
		expect(await bridge.pause()).toBe(true);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)?.text).toBe("That question timed out.");
		expect(peers[0].disposed()).toBe(0);

		peers[0].release("finished after pause");
		await waitFor(() => sent.some((item) => item.text === "finished after pause"));
		await bridge.close();
		expect(peers[0].disposed()).toBe(1);
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

	test("reports running state changes for a status chip", async () => {
		const { client } = makeClient([]);
		const states: BridgeState[] = [];
		const { deps } = makeDeps(client, { onStateChange: (state) => states.push(state) });
		const bridge = createBridge(deps);
		bridge.open();
		expect(states).toEqual(["running"]);
		await bridge.close();
		expect(states).toEqual(["running", "stopped"]);
	});

	test("reports expired instead of stopped when the session expires", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		const states: BridgeState[] = [];
		const { deps } = makeDeps(client, { onStateChange: (state) => states.push(state) });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => states.includes("expired"));
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

	test("claims the owner on the first open", () => {
		const { client } = makeClient([]);
		const { deps, saved } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		expect(saved.at(-1)?.ownerId).toBe(owner);
		void bridge.close();
	});

	test("starts empty state for a different account than the stored one", () => {
		// state.json outlives credentials.json: after a logout and a login as another
		// account, the old owner, cursor, and tokens must not be reused, or the new
		// account's own sender would be refused.
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
});

/**
 * The turn lifecycle must survive the host: a prompt can be rejected
 * asynchronously, and a poll can hang or be rejected without a transport error.
 * Every path either recovers or says so, and none of them wedges the queue.
 */
describe("bridge resilience", () => {
	test("reports a reply the server rejected instead of claiming delivery", async () => {
		const notifications: string[] = [];
		const base = makeClient([updates([inbound("q")])]);
		const client = {
			...base.client,
			sendMessage: async () => ({ ret: -1 }),
		} as unknown as WechatClient;
		const { deps, injected, peers } = makeDeps(
			client,
			{ notify: (message) => notifications.push(message) },
			{ hold: true },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		peers[0]?.release("answer");
		await waitFor(() => notifications.length === 1);
		expect(notifications[0]).toContain("rejected");
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

	test("send_wechat reports a rejected send instead of claiming delivery", async () => {
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

	test("send_wechat reports the errcode when ret is zero", async () => {
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

	test("send_wechat flattens Markdown and numbers split parts", async () => {
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

	test("send_wechat reports a message that formats down to nothing", async () => {
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

	test("retries a wedged poll and reports it once", async () => {
		const notifications: string[] = [];
		let polls = 0;
		const base = makeClient([]);
		const client = {
			...base.client,
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				polls += 1;
				if (polls === 3) return updates([inbound("after timeout")], "c2");
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(client, {
			pollTimeout: () => 10,
			notify: (message) => notifications.push(message),
		});
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("after timeout");
		// Two timeouts, one episode: a wedged poll is reported once and retried.
		expect(notifications.filter((message) => message.includes("timed out"))).toHaveLength(1);
		await bridge.close();
	});

	test("backs off when the poll is rejected and keeps the cursor", async () => {
		const notifications: string[] = [];
		const sleeps: number[] = [];
		let polls = 0;
		const base = makeClient([]);
		const client = {
			...base.client,
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				polls += 1;
				if (polls < 3) return { ret: -1, msgs: [], buf: "" };
				if (polls === 3) return updates([inbound("after reject")]);
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const { deps, injected } = makeDeps(client, {
			pollTimeout: () => 10,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			notify: (message) => notifications.push(message),
		});
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("after reject");
		expect(sleeps).toContain(2000);
		expect(notifications.filter((message) => message.includes("rejected"))).toHaveLength(1);
		await bridge.close();
	});
});
