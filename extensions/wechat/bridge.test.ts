import { createCipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { waitFor } from "../../test/helpers/process.ts";
import {
	assistantText,
	type BridgeDeps,
	type BridgeState,
	createBridge,
	isAllowedPeer,
	isInboundMessage,
	type UserContent,
} from "./bridge.ts";
import type { WechatClient } from "./client.ts";
import type { SlashCommand } from "./slash.ts";
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

	test("queues inbound while busy and coalesces it after settle", async () => {
		const { client } = makeClient([updates([inbound("one"), inbound("two")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => bridge.status().queued === 2);
		expect(injected).toEqual([]);

		bridge.settle();
		await waitFor(() => injected.length === 1);
		// A burst from one peer is one ask, in order, not one turn per message.
		expect(injected[0]).toBe("one\ntwo");
		await bridge.close();
	});

	test("keeps messages from different peers in separate turns", async () => {
		const other = "friend@im.wechat";
		const { client } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, allowedPeers: [other] } });
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => bridge.status().queued === 2);

		bridge.settle();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("mine");
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
		expect(injected[0]).toEqual([
			{ type: "text", text: "look" },
			// The model is told the image was skipped instead of assuming it saw it.
			{ type: "text", text: "[WeChat media skipped: 1]" },
		]);
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
		expect(injected[0]).toEqual([
			{ type: "text", text: "big" },
			{ type: "text", text: "[WeChat media skipped: 1]" },
		]);
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
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "it is a cat" }] });
		bridge.settle();
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

	test("refuses to repeat the answer of the turn in flight", async () => {
		const { client, sent } = makeClient([updates([inbound("hi")])]);
		const { deps, injected } = makeDeps(client);
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
		const { deps, injected } = makeDeps(client, {
			config: { ...DEFAULT_CONFIG, allowedPeers: [other] },
			loadState: () => ({ cursor: "", peers: { [owner]: { lastContextToken: "ctx", lastSeen: 0 } } }),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		expect(await bridge.sendToOwner("note to self")).toEqual({ ok: true });
		expect(sent[0]).toMatchObject({ to: owner, text: "note to self" });
		await bridge.close();
	});
});

describe("bridge slash commands", () => {
	test("expands a snippet command into the injected turn", async () => {
		const commands: SlashCommand[] = [{ name: "sum", summary: "s", kind: "snippet", snippet: "Summarize." }];
		const { client } = makeClient([updates([inbound("/sum extra")])]);
		const { deps, injected } = makeDeps(client, { slashCommands: commands });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		expect(injected[0]).toBe("Summarize.\n\nextra");
		await bridge.close();
	});

	test("runs an action and replies without injecting a turn", async () => {
		const calls: string[] = [];
		const commands: SlashCommand[] = [
			{
				name: "hi",
				summary: "s",
				kind: "action",
				run: async (ctx) => {
					calls.push(ctx.args);
					await ctx.reply("hello there");
				},
			},
		];
		const { client, sent } = makeClient([updates([inbound("/hi a b")])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: commands,
			sessionControls: () => ({ newSession: () => calls.push("new") }),
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
		const commands: SlashCommand[] = [
			{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
		];
		const { client, sent } = makeClient([updates([inbound("/new", peer)])]);
		const { deps, injected } = makeDeps(client, {
			slashCommands: commands,
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
		const commands: SlashCommand[] = [
			{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
		];
		const { client } = makeClient([updates([inbound("/new", "boss@im.wechat")])]);
		const { deps } = makeDeps(client, {
			slashCommands: commands,
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
		const { deps, injected } = makeDeps(client, {
			slashCommands: [
				{ name: "new", summary: "s", kind: "action", ownerOnly: true, run: () => void calls.push("ran") },
			],
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		const blocks = injected[0] as Array<{ type: string; text?: string }>;
		expect(blocks[0]).toEqual({ type: "text", text: "/new" });
		expect(calls).toEqual([]);
		await bridge.close();
	});
});

/**
 * A client that delivers one inbound message, then holds the poll open until the
 * test pushes the next one, so a prompt can be answered deterministically.
 */
function controllableClient(): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
	sentFiles: Array<{ to: string; fileName: string; len: string }>;
	deliver: (message: WeixinMessage) => void;
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	const sentFiles: Array<{ to: string; fileName: string; len: string }> = [];
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
		getUploadUrl: async () => ({ uploadParam: "up" }),
		uploadCdn: async () => "dl",
		sendFileMessage: async (_account: BotCredentials, args: { to: string; fileName: string; len: string }) => {
			sentFiles.push(args);
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
		sentFiles,
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

	test("chunks a long post to the peer", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxReplyChars: 4 } });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		await bridge.channel().post("abcdefgh");
		// A split reply is numbered so the peer knows how much is still coming.
		expect(sent.map((message) => message.text)).toEqual(["[1/2] abcd", "[2/2] efgh"]);
		await bridge.close();
	});

	test("uploads and sends a file through the channel", async () => {
		const { client, sentFiles } = controllableClient();
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel().postFile(path, "plan.md")).toBe(true);
		expect(sentFiles[0]).toMatchObject({ to: owner, fileName: "plan.md", len: "4" });
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

/** A fake timer seam: nothing fires until the test calls `fire()`. */
function fakeTimers(): { arm: (ms: number, fn: () => void) => () => void; fire: () => void; count: () => number } {
	const pending = new Map<number, () => void>();
	let next = 0;
	return {
		arm: (_ms: number, fn: () => void) => {
			next += 1;
			const id = next;
			pending.set(id, fn);
			return () => pending.delete(id);
		},
		fire: () => {
			const fns = [...pending.values()];
			pending.clear();
			for (const fn of fns) fn();
		},
		count: () => pending.size,
	};
}

/** A client whose replies are held until the test releases them. */
function gatedClient(): {
	client: WechatClient;
	sent: string[];
	releaseReply: () => void;
	deliver: (message: WeixinMessage) => void;
} {
	const sent: string[] = [];
	let deliver: ((message: WeixinMessage) => void) | undefined;
	let first = true;
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
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
		sendMessage: async (_account: BotCredentials, args: { text: string }) => {
			await gate;
			sent.push(args.text);
			return { ret: 0 };
		},
		getConfig: async () => ({ ret: 0 }),
		sendTyping: async () => ({ ret: 0 }),
		downloadCdn: async () => {
			throw new Error("no media");
		},
	} as unknown as WechatClient;
	return { client, sent, releaseReply: () => release(), deliver: (message) => deliver?.(message) };
}

describe("bridge peer feedback", () => {
	test("sends nothing when a reply flattens to an empty message", async () => {
		const { client, sent } = makeClient([updates([inbound("ping")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		// Only formatting survives: flattening it away must not send an empty bubble,
		// so the turn reads as stopped instead.
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "```\n```" }] });
		bridge.settle();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("Stopped.");
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
		const { deps, injected } = makeDeps(client, {
			config: { ...DEFAULT_CONFIG, maxReplyChars: 4 },
			notify: (message) => notifications.push(message),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "abcdefgh" }] });
		bridge.settle();
		await waitFor(() => notifications.length === 1);

		expect(sent).toEqual(["[1/2] abcd"]);
		expect(notifications[0]).toContain("after 1 of 2 parts were sent");
		await bridge.close();
	});

	test("holds the queue until the reply is out", async () => {
		const gated = gatedClient();
		const { deps, injected } = makeDeps(gated.client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		bridge.capture({ role: "assistant", content: [{ type: "text", text: "pong" }] });
		bridge.settle();
		// A message that lands while the reply is flushing must wait for it.
		gated.deliver(inbound("second"));
		await waitFor(() => bridge.status().queued === 1);
		expect(injected).toEqual(["ping"]);
		expect(gated.sent).toEqual([]);

		gated.releaseReply();
		await waitFor(() => injected.length === 2);
		expect(gated.sent).toEqual(["pong"]);
		expect(injected[1]).toBe("second");
		await bridge.close();
	});

	test("acknowledges a peer that has waited, once", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("one"), inbound("two")])]);
		const { deps, injected } = makeDeps(client, { armTimer: timers.arm });
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => bridge.status().queued === 2);

		timers.fire();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("Got it — working on it.");
		expect(injected).toEqual([]);

		timers.fire();
		expect(sent).toHaveLength(1);
		await bridge.close();
	});

	test("does not acknowledge a wait that ends at once", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("one")])]);
		const { deps, injected } = makeDeps(client, { armTimer: timers.arm });
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => bridge.status().queued === 1);

		bridge.setBusy(false);
		bridge.settle();
		await waitFor(() => injected.length === 1);
		timers.fire();
		expect(sent).toEqual([]);
		await bridge.close();
	});

	test("starts the typing indicator while the message is still queued", async () => {
		const timers = fakeTimers();
		const { client, typing } = makeClient([updates([inbound("one")])]);
		const { deps } = makeDeps(client, { armTimer: timers.arm });
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();

		await waitFor(() => typing.length === 1);
		expect(typing[0]).toEqual({ ilinkUserId: owner, typing: true });
		// The turn never starts, so the indicator is refreshed instead of lapsing.
		timers.fire();
		await waitFor(() => typing.length >= 2);
		expect(typing.at(-1)?.typing).toBe(true);
		await bridge.close();
	});

	test("tells the peer when a turn produced no answer", async () => {
		const { client, sent } = makeClient([updates([inbound("go")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		bridge.settle();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("Stopped.");
		await bridge.close();
	});

	test("answers in the peer's language", async () => {
		const { client, sent } = makeClient([updates([inbound("你好")])]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		bridge.setBusy(true);
		bridge.settle();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("已停止。");
		await bridge.close();
	});

	test("tells the peer when the turn could not start", async () => {
		const { client, sent } = makeClient([updates([inbound("hi")])]);
		const { deps } = makeDeps(client, {
			sendUserMessage: () => {
				throw new Error("session is streaming");
			},
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toBe("Something went wrong — please try again.");
		await bridge.close();
	});

	test("refuses a queued message beyond the cap with one notice", async () => {
		const burst = Array.from({ length: 10 }, (_unused, index) => inbound(`m${index}`));
		const { client, sent } = makeClient([updates(burst)]);
		const { deps, injected } = makeDeps(client);
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toBe("Too many messages queued — please wait a moment.");
		expect(bridge.status().queued).toBe(8);
		expect(injected).toEqual([]);
		await bridge.close();
	});

	test("declines /new while a run is in flight", async () => {
		let restarted = 0;
		const { client, sent } = makeClient([updates([inbound("/new")])]);
		const { deps } = makeDeps(client, {
			sessionControls: () => ({
				newSession: () => {
					restarted += 1;
				},
			}),
		});
		const bridge = createBridge(deps);
		bridge.setBusy(true);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toContain("send /new again");
		expect(restarted).toBe(0);
		await bridge.close();
	});

	test("starts a new session on /new when nothing is running", async () => {
		let restarted = 0;
		const { client, sent } = makeClient([updates([inbound("/new")])]);
		const { deps } = makeDeps(client, {
			sessionControls: () => ({
				newSession: () => {
					restarted += 1;
				},
			}),
		});
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => restarted === 1);

		expect(sent[0]?.text).toContain("Starting a new session");
		await bridge.close();
	});
});
