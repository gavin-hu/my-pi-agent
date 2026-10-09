import { createCipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { waitFor } from "../../test/helpers/process.ts";
import {
	assistantText,
	type BridgeDeps,
	createBridge,
	isAllowedPeer,
	isInboundMessage,
	type UserContent,
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

const owner = "owner@im.wechat";
const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");

function inbound(text: string, peer = owner, contextToken: string | undefined = "ctx"): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: contextToken,
		item_list: [{ type: 1, text_item: { text } }],
	};
}

function inboundImage(peer = owner): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: "ctx",
		item_list: [{ type: 2, image_item: { media: { full_url: "https://cdn/i" }, aeskey: key.toString("hex") } }],
	};
}

function inboundImageWithKey(peer = owner, aeskey = key.toString("hex")): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: "ctx",
		item_list: [{ type: 2, image_item: { media: { full_url: "https://cdn/i" }, aeskey } }],
	};
}

function inboundFile(peer = owner): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: "ctx",
		item_list: [
			{
				type: 4,
				file_item: {
					media: { full_url: "https://cdn/f", aes_key: key.toString("base64") },
					file_name: "notes.txt",
				},
			},
		],
	};
}

function encrypt(plain: Uint8Array): Buffer {
	const cipher = createCipheriv("aes-128-ecb", key, null);
	return Buffer.concat([cipher.update(plain), cipher.final()]);
}

function updates(msgs: WeixinMessage[], buf = "c1"): UpdatesResponse {
	return { ret: 0, msgs, buf };
}

interface ClientOptions {
	/** URL -> ciphertext bytes for downloadCdn. */
	media?: Record<string, Uint8Array>;
	/** Omit the typing ticket, disabling the indicator. */
	noTicket?: boolean;
}

function makeClient(
	script: UpdatesResponse[],
	options: ClientOptions = {},
): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
	typing: Array<{ ilinkUserId: string; typing: boolean }>;
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	const typing: Array<{ ilinkUserId: string; typing: boolean }> = [];
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
		getConfig: async (): Promise<{ ret?: number; typingTicket?: string }> =>
			options.noTicket ? { ret: 0 } : { ret: 0, typingTicket: "ticket" },
		sendTyping: async (
			_account: BotCredentials,
			args: { ilinkUserId: string; typingTicket: string; typing: boolean },
		): Promise<{ ret?: number }> => {
			typing.push({ ilinkUserId: args.ilinkUserId, typing: args.typing });
			return { ret: 0 };
		},
		downloadCdn: async (ref: { full_url?: string; encrypt_query_param?: string }): Promise<Uint8Array> => {
			const bytes = options.media?.[ref.full_url ?? ref.encrypt_query_param ?? ""];
			if (!bytes) throw new Error("no media");
			return bytes;
		},
	};
	return { client: client as unknown as WechatClient, sent, typing };
}

function makeDeps(client: WechatClient, overrides: Partial<BridgeDeps> = {}) {
	const injected: UserContent[] = [];
	const saved: WechatState[] = [];
	const released = { count: 0 };
	const deps: BridgeDeps = {
		config: { ...DEFAULT_CONFIG },
		now: () => 1000,
		isIdle: () => true,
		sendUserMessage: (content) => injected.push(content),
		mediaDir: () => tempDir("wechat-files-"),
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
		expect(sent[0]).toEqual({ to: owner, text: "pong", contextToken: "ctx" });
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

describe("bridge media", () => {
	test("downloads, decrypts, and injects an image as content", async () => {
		const plain = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
		const { client } = makeClient([updates([inboundImage()])], { media: { "https://cdn/i": encrypt(plain) } });
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toEqual([{ type: "image", data: plain.toString("base64"), mimeType: "image/png" }]);
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
		const blocks = injected[0] as Array<{ type: string; text: string }>;
		const prefix = "[WeChat file: notes.txt saved to ";
		expect(blocks[0]?.text.startsWith(prefix)).toBe(true);
		const path = blocks[0]?.text.slice(prefix.length).replace(/\]$/, "");
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
		expect(injected[0]).toEqual([{ type: "text", text: "look" }]);
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
		expect(injected[0]).toEqual([{ type: "text", text: "big" }]);
		await waitFor(() => bridge.status().mediaDropped === 1);
		await bridge.close();
	});
});

describe("bridge typing indicator", () => {
	test("sets typing before a turn and cancels it before the reply", async () => {
		const { client, typing } = makeClient([updates([inbound("ping")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		await waitFor(() => typing.length >= 1);
		expect(typing[0]).toEqual({ ilinkUserId: owner, typing: true });

		bridge.setBusy(true);
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "pong" }] });
		bridge.settle();
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
		await bridge.close();
	});

	test("fails when the bridge is not started", async () => {
		const { client } = makeClient([]);
		const { deps } = makeDeps(client);
		const bridge = createBridge(deps);
		expect(await bridge.sendToOwner("hello")).toEqual({ ok: false, error: "WeChat bridge is not started." });
	});
});

/**
 * A client that delivers one inbound message, then holds the poll open until the
 * test pushes the next one, so a prompt can be answered deterministically.
 */
function controllableClient(): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
	deliver: (message: WeixinMessage) => void;
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	let deliver: ((message: WeixinMessage) => void) | undefined;
	let first = true;
	const client = {
		getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
			if (first) {
				first = false;
				return updates([inbound("ping")]);
			}
			return await new Promise<UpdatesResponse>((resolve) => {
				deliver = (message) => resolve(updates([message]));
				signal?.addEventListener("abort", () => resolve({ ret: 0, msgs: [], buf: "c" }), { once: true });
			});
		},
		sendMessage: async (_account: BotCredentials, args: { to: string; text: string; contextToken?: string }) => {
			sent.push(args);
			return { ret: 0 };
		},
		getConfig: async () => ({ ret: 0 }),
		sendTyping: async () => ({ ret: 0 }),
		downloadCdn: async () => {
			throw new Error("no media");
		},
	} as unknown as WechatClient;
	return {
		client,
		sent,
		deliver: (message) => deliver?.(message),
	};
}

describe("bridge remote prompts", () => {
	test("sends a dialog to WeChat and consumes the reply as an answer", async () => {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "select", title: "Pick", options: ["A", "B"] });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		expect(sent[0]?.text).toContain("Pick");

		deliver(inbound("2"));
		expect(await answer).toEqual({ kind: "value", value: "B" });
		// The reply answered the prompt instead of starting a new turn.
		expect(injected.length).toBe(1);
		await bridge.close();
	});

	test("resolves a pending prompt as cancelled when the bridge closes", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const answer = bridge.channel().request({ kind: "confirm", title: "Sure?" });
		await waitFor(() => sent.length >= 1 && bridge.status().promptPending);
		await bridge.close();
		expect(await answer).toEqual({ kind: "cancelled" });
	});
});
