import { describe, expect, test } from "bun:test";
import { waitFor } from "../../test/helpers/process.ts";
import {
	assistantText,
	type BridgeDeps,
	createBridge,
	isAllowedPeer,
	isInboundMessage,
	messageText,
} from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import type { BotCredentials, UpdatesResponse, WeixinMessage, WechatState } from "./types.ts";

const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function inbound(text: string, peer = "owner@im.wechat", contextToken: string | undefined = "ctx"): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: contextToken,
		item_list: [{ type: 1, text_item: { text } }],
	};
}

function updates(msgs: WeixinMessage[], buf = "c1"): UpdatesResponse {
	return { ret: 0, msgs, buf };
}

function makeClient(script: UpdatesResponse[]): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	const queue = [...script];
	const client = {
		getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
			if (signal?.aborted) throw new Error("aborted");
			const next = queue.shift();
			if (next) return next;
			await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
			throw new Error("aborted");
		},
		sendMessage: async (
			_account: BotCredentials,
			args: { to: string; text: string; contextToken?: string },
		): Promise<{ ret?: number }> => {
			sent.push({ to: args.to, text: args.text, contextToken: args.contextToken });
			return { ret: 0 };
		},
	};
	return { client: client as unknown as WechatClient, sent };
}

function makeDeps(client: WechatClient, overrides: Partial<BridgeDeps> = {}) {
	const injected: string[] = [];
	const saved: WechatState[] = [];
	const released = { count: 0 };
	const deps: BridgeDeps = {
		config: { ...DEFAULT_CONFIG },
		now: () => 1000,
		isIdle: () => true,
		sendUserMessage: (text) => injected.push(text),
		loadAccount: () => account,
		loadState: () => ({ cursor: "", peers: {} }),
		saveState: (state) => saved.push(state),
		createClient: () => client,
		acquireLock: () => true,
		refreshLock: () => {},
		releaseLock: () => {
			released.count += 1;
		},
		sleep: async () => {},
		...overrides,
	};
	return { deps, injected, saved, released };
}

describe("message helpers", () => {
	test("messageText returns the first text item", () => {
		expect(messageText(inbound("hello"))).toBe("hello");
		expect(messageText({ from_user_id: "u", item_list: [{ type: 2 }] })).toBe("");
	});

	test("assistantText joins text blocks and ignores other roles", () => {
		expect(
			assistantText({
				role: "assistant",
				content: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" },
				],
			}),
		).toBe("a\nb");
		expect(assistantText({ role: "user", content: [{ type: "text", text: "a" }] })).toBeUndefined();
	});

	test("isAllowedPeer accepts the owner and explicit peers only", () => {
		expect(isAllowedPeer("owner", "owner", [])).toBe(true);
		expect(isAllowedPeer("friend", "owner", ["friend"])).toBe(true);
		expect(isAllowedPeer("stranger", "owner", ["friend"])).toBe(false);
	});

	test("isInboundMessage rejects the bot echo and messages without a sender", () => {
		expect(isInboundMessage({ from_user_id: "u", message_type: 1 })).toBe(true);
		expect(isInboundMessage({ from_user_id: "u", message_type: 2 })).toBe(false);
		expect(isInboundMessage({ message_type: 1 })).toBe(false);
	});
});

describe("bridge", () => {
	test("injects an inbound message and sends the reply back", async () => {
		const { client, sent } = makeClient([updates([inbound("ping")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("ping");

		bridge.setBusy(true);
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "pong" }] });
		bridge.settle();
		await waitFor(() => sent.length === 1);
		expect(sent[0]).toEqual({ to: "owner@im.wechat", text: "pong", contextToken: "ctx" });
		await bridge.close();
	});

	test("queues inbound while busy and injects after settle", async () => {
		const { client } = makeClient([updates([inbound("one"), inbound("two")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => bridge.status().queued === 2);
		expect(injected).toEqual([]);

		bridge.settle();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("one");
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

	test("refuses to open without credentials", () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client, { loadAccount: () => undefined });
		const bridge = createBridge(deps);
		expect(() => bridge.open()).toThrow();
	});

	test("stops and reports when the session expires", async () => {
		const { client } = makeClient([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		let expired = 0;
		const { deps } = makeDeps(client, {
			onExpired: () => {
				expired += 1;
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => expired === 1);
		expect(bridge.status().open).toBe(false);
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
});
