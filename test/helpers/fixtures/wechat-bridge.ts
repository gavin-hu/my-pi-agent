/**
 * Fixture for the WeChat bridge suite.
 *
 * The bridge talks to Weixin through a `WechatClient` and to the host through
 * `BridgeDeps`; these doubles let a test drive the real poll loop — inject a
 * message, answer it, wait for the reply — with no network and no real timers.
 *
 * Value-only: every recorder and queue is created per call.
 */

import { createCipheriv } from "node:crypto";
import type { BridgeDeps } from "../../../extensions/wechat/bridge.ts";
import type { WechatClient } from "../../../extensions/wechat/transport/client.ts";
import { DEFAULT_CONFIG } from "../../../extensions/wechat/config.ts";
import type { PeerSession } from "../../../extensions/wechat/peer/peer-session.ts";
import type { BotCredentials, UpdatesResponse, WechatState, WeixinMessage } from "../../../extensions/wechat/types.ts";
import { tempDir } from "../env.ts";

export const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

export const owner = "owner@im.wechat";
export const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");

export function inbound(text: string, peer = owner, contextToken: string | undefined = "ctx"): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: contextToken,
		item_list: [{ type: 1, text_item: { text } }],
	};
}

/** A message carrying the server's id, for the replay guard. */
export function inboundWithId(text: string, id: number, peer = owner): WeixinMessage {
	return { ...inbound(text, peer), message_id: id };
}

export function inboundImage(peer = owner): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: "ctx",
		item_list: [{ type: 2, image_item: { media: { full_url: "https://cdn/i" }, aeskey: key.toString("hex") } }],
	};
}

export function inboundImageWithKey(peer = owner, aeskey = key.toString("hex")): WeixinMessage {
	return {
		from_user_id: peer,
		message_type: 1,
		context_token: "ctx",
		item_list: [{ type: 2, image_item: { media: { full_url: "https://cdn/i" }, aeskey } }],
	};
}

export function inboundFile(peer = owner): WeixinMessage {
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

export function encrypt(plain: Uint8Array): Buffer {
	const cipher = createCipheriv("aes-128-ecb", key, null);
	return Buffer.concat([cipher.update(plain), cipher.final()]);
}

export function updates(msgs: WeixinMessage[], buf = "c1"): UpdatesResponse {
	return { ret: 0, msgs, buf };
}

export interface ClientOptions {
	/** URL -> ciphertext bytes for downloadCdn. */
	media?: Record<string, Uint8Array>;
	/** Omit the typing ticket, disabling the indicator. */
	noTicket?: boolean;
	/** Refuse a send whose signal is already aborted, as `fetch` would. */
	respectSignal?: boolean;
}

export function makeClient(
	script: UpdatesResponse[],
	options: ClientOptions = {},
): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
	typing: Array<{ ilinkUserId: string; typing: boolean }>;
	calls: { polls: number };
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	const typing: Array<{ ilinkUserId: string; typing: boolean }> = [];
	const queue = [...script];
	const calls = { polls: 0 };
	const client = {
		getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
			calls.polls += 1;
			if (signal?.aborted) throw new Error("aborted");
			const next = queue.shift();
			if (next) return next;
			await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
			throw new Error("aborted");
		},
		sendMessage: async (
			_account: BotCredentials,
			args: { to: string; text: string; contextToken?: string },
			signal?: AbortSignal,
		): Promise<{ ret?: number }> => {
			if (options.respectSignal && signal?.aborted) throw new Error("aborted");
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
	return { client: client as unknown as WechatClient, sent, typing, calls };
}

export interface Script {
	/** Hold the first turn of each session until `release` is called. */
	hold?: boolean;
	/** Answers, in order; a session with none answers "pong". */
	answers?: string[];
}

export interface FakePeer {
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
export function fakePeer(script: Script): FakePeer {
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

export function makeDeps(client: WechatClient, overrides: Partial<BridgeDeps> = {}, script: Script = {}) {
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
		readHistory: async () => "",
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

/**
 * A client that delivers one inbound message, then holds the poll open until the
 * test pushes the next one, so a prompt can be answered deterministically.
 */
export function controllableClient(options: ClientOptions = {}): {
	client: WechatClient;
	sent: Array<{ to: string; text: string; contextToken?: string }>;
	sentFiles: Array<{ to: string; fileName: string; len: string }>;
	sentImages: Array<{ to: string; midSize: number; aeskey: string; contextToken?: string }>;
	deliver: (message: WeixinMessage) => void;
} {
	const sent: Array<{ to: string; text: string; contextToken?: string }> = [];
	const sentFiles: Array<{ to: string; fileName: string; len: string }> = [];
	const sentImages: Array<{ to: string; midSize: number; aeskey: string; contextToken?: string }> = [];
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
		sendMessage: async (
			_account: BotCredentials,
			args: { to: string; text: string; contextToken?: string },
			signal?: AbortSignal,
		) => {
			if (options.respectSignal && signal?.aborted) throw new Error("aborted");
			sent.push(args);
			return { ret: 0 };
		},
		getUploadUrl: async () => ({ uploadParam: "up" }),
		uploadCdn: async () => "dl",
		sendFileMessage: async (_account: BotCredentials, args: { to: string; fileName: string; len: string }) => {
			sentFiles.push(args);
			return { ret: 0 };
		},
		sendImageMessage: async (
			_account: BotCredentials,
			args: { to: string; midSize: number; aeskey: string; contextToken?: string },
		) => {
			sentImages.push(args);
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
		sentImages,
		deliver: (message) => deliver?.(message),
	};
}

/** A fake timer seam: nothing fires until the test calls `fire()`. */
export function fakeTimers(): {
	arm: (ms: number, fn: () => void) => () => void;
	fire: () => void;
	count: () => number;
} {
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
