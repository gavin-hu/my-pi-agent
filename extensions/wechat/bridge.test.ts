import { createCipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { settle, waitFor } from "../../test/helpers/process.ts";
import { type BridgeDeps, type BridgeState, createBridge, isAllowedPeer, isInboundMessage } from "./bridge.ts";
import type { PeerSession } from "./peer-session.ts";
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

interface Script {
	/** Hold the first turn of each session until `release` is called. */
	hold?: boolean;
	/** Answers, in order; a session with none answers "pong". */
	answers?: string[];
}

interface FakePeer {
	peerSession: PeerSession;
	session: {
		prompt: (text: string, options?: { images?: unknown }) => Promise<void>;
		getLastAssistantText: () => string;
		abort: () => Promise<void>;
		dispose: () => void;
	};
	prompts: Array<{ text: string; images?: unknown }>;
	release: (answer?: string) => void;
	disposed: () => number;
}

/** A peer session double: records the prompt and answers with the script. */
function fakePeer(script: Script): FakePeer {
	const prompts: Array<{ text: string; images?: unknown }> = [];
	const answers = [...(script.answers ?? ["pong"])];
	let last = "";
	let pending: ((answer: string) => void) | undefined;
	let disposals = 0;
	const session = {
		async prompt(text: string, options?: { images?: unknown }): Promise<void> {
			prompts.push({ text, images: options?.images });
			const answer =
				script.hold && prompts.length === 1
					? await new Promise<string>((resolve) => {
							pending = resolve;
						})
					: (answers.shift() ?? "");
			last = answer;
		},
		getLastAssistantText: () => last,
		// No deltas: the worker falls back to the final text, as a non-streaming
		// provider would.
		subscribe: () => () => {},
		async abort(): Promise<void> {
			const resolve = pending;
			pending = undefined;
			resolve?.("");
		},
		dispose(): void {
			disposals += 1;
		},
	};
	return {
		peerSession: { session, dispose: () => session.dispose() } as unknown as PeerSession,
		session,
		prompts,
		release: (answer?: string) => {
			const resolve = pending;
			pending = undefined;
			resolve?.(answer ?? answers.shift() ?? "");
		},
		disposed: () => disposals,
	};
}

function makeDeps(client: WechatClient, overrides: Partial<BridgeDeps> = {}, script: Script = {}) {
	const peers: FakePeer[] = [];
	const injected: string[] = [];
	const saved: WechatState[] = [];
	const released = { count: 0 };
	const deps: BridgeDeps = {
		config: { ...DEFAULT_CONFIG },
		now: () => 1000,
		openSession: async () => {
			const peer = fakePeer(script);
			const prompt = peer.session.prompt.bind(peer.session);
			peer.session.prompt = async (text, options) => {
				injected.push(text);
				await prompt(text, options);
			};
			peers.push(peer);
			return peer.peerSession;
		},
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
	return { deps, peers, injected, saved, released };
}

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

describe("bridge media", () => {
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

describe("bridge typing indicator", () => {
	test("sets typing before a turn and cancels it before the reply", async () => {
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
		const { deps, injected } = makeDeps(client, { slashCommands: commands });
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
		const { deps, injected } = makeDeps(client, {}, { hold: true });
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
		const { deps, injected } = makeDeps(client, { config: { ...DEFAULT_CONFIG, maxReplyChars: 4 } }, { hold: true });
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
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		const path = join(tempDir("wechat-bridge-file-"), "plan.md");
		writeFileSync(path, "plan");
		expect(await bridge.channel().postFile(path, "plan.md")).toBe(true);
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
		await bridge.channel().post("plan digest");
		await bridge.channel().post("second try");
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
		expect(await bridge.channel().postFile(path, "plan.md")).toBe(false);
		expect(notifications.some((message) => message.includes("file delivery failed for plan.md"))).toBe(true);
		await bridge.close();
	});

	test("resolves a pending prompt as cancelled when the bridge closes", async () => {
		const { client, sent } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
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

describe("bridge peer feedback", () => {
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

	test("acknowledges a peer waiting on another conversation, once, then says why", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, injected } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		// One turn at a time: the second peer waits for a slot.
		await waitFor(() => bridge.status().queued === 1);
		expect(injected).toHaveLength(1);

		timers.fire();
		await settle();
		expect(sent.some((message) => message.text === "Got it — working on it.")).toBe(true);

		// A minute later it is still waiting: say so once, and only once.
		timers.fire();
		await settle();
		const busy = () => sent.filter((message) => message.text.includes("queued behind another conversation"));
		expect(busy()).toHaveLength(1);
		timers.fire();
		await settle();
		expect(busy()).toHaveLength(1);
		await bridge.close();
	});

	test("does not acknowledge a wait that ends at once", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, sent } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps, peers } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => bridge.status().queued === 1);

		// The first turn ends before the 4 s timer: the second starts, no ack.
		peers[0]?.release("for me");
		await waitFor(() => sent.some((message) => message.text === "for me"));
		timers.fire();
		await settle();
		// No acknowledgement: the second turn started before the timer mattered.
		expect(sent.some((message) => message.text === "Got it — working on it.")).toBe(false);
		await bridge.close();
	});

	test("starts the typing indicator for a message that is waiting", async () => {
		const timers = fakeTimers();
		const other = "friend@im.wechat";
		const { client, typing } = makeClient([updates([inbound("mine"), inbound("theirs", other)])]);
		const { deps } = makeDeps(
			client,
			{ config: { ...DEFAULT_CONFIG, allowedPeers: [other] }, armTimer: timers.arm },
			{ hold: true, answers: ["for me", "for them"] },
		);
		const bridge = createBridge(deps);
		bridge.open();

		await waitFor(() => typing.some((call) => call.ilinkUserId === other));
		expect(typing.some((call) => call.typing === true)).toBe(true);
		// The indicator is refreshed while the peer waits, instead of lapsing.
		const before = typing.length;
		timers.fire();
		await waitFor(() => typing.length > before);
		expect(typing.at(-1)?.typing).toBe(true);
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

	test("refuses a queued message beyond the cap with one notice", async () => {
		const other = "friend@im.wechat";
		const burst = [inbound("held"), ...Array.from({ length: 10 }, (_unused, index) => inbound(`m${index}`, other))];
		const { client, sent } = makeClient([updates(burst)]);
		const { deps } = makeDeps(client, { config: { ...DEFAULT_CONFIG, allowedPeers: [other] } }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => sent.length === 1);

		expect(sent[0]?.text).toBe("Too many messages queued — please wait a moment.");
		expect(bridge.status().queued).toBe(8);
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

	test("does not say still-working while a dialog is waiting for an answer", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("slow")])]);
		const { deps, peers } = makeDeps(client, { armTimer: timers.arm }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => (peers[0]?.prompts.length ?? 0) === 1);

		// The turn asks the peer a question and waits for the answer.
		const answer = bridge.channel().request({ kind: "confirm", title: "Sure?" });
		await waitFor(() => bridge.status().promptPending);
		timers.fire();
		await settle();
		// The prompt nudges for itself; "still working" would be a second bubble.
		const texts = sent.map((message) => message.text).join("\n");
		expect(texts).not.toContain("Still working");
		expect(texts).toContain("Sure?");

		bridge.channel().handleInbound(owner, "yes");
		await answer;
		await bridge.close();
	});

	test("says the running turn is still going after a while", async () => {
		const timers = fakeTimers();
		const { client, sent } = makeClient([updates([inbound("slow")])]);
		const { deps, injected } = makeDeps(client, { armTimer: timers.arm }, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);

		timers.fire();
		await waitFor(() => sent.length === 1);
		expect(sent[0]?.text).toContain("Still working");

		// One line per slow turn, not a heartbeat.
		timers.fire();
		expect(sent).toHaveLength(1);
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
		expect(result).toEqual({ ok: false, error: "Weixin rejected the message (ret -2)." });
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
