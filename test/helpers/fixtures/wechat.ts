/**
 * Fixture for the wechat extension suite.
 *
 * The bridge talks to Weixin through a `WechatClient`, and the extension builds
 * that client through its factory `deps`. These doubles let a test drive the
 * real poll loop — inject a message, answer it, wait for the reply — with no
 * network and no real timer: a scripted `getUpdates` queue answers the first
 * polls, and the last one parks until the loop is aborted.
 *
 * Value-only: every recorder and queue is created per call.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WechatClient, WechatClientOptions } from "../../../extensions/wechat/client.ts";
import type { BotCredentials, UpdatesResponse, WeixinMessage } from "../../../extensions/wechat/types.ts";

/** A stored account, as the login flow would have saved it. */
export const ACCOUNT: BotCredentials = {
	botToken: "token",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "bot",
	baseUrl: "https://ilink.test",
	botAgent: "pi-wechat",
	createdAt: 0,
};

/** A text message from a peer. */
export function inboundText(text: string, from = ACCOUNT.ilinkUserId): WeixinMessage {
	return {
		from_user_id: from,
		message_type: 1,
		context_token: "ctx",
		item_list: [{ type: 1, text_item: { text } }],
	};
}

/** One long-poll response carrying `msgs`. */
export function updates(msgs: WeixinMessage[] = [], buf = "cursor-1"): UpdatesResponse {
	return { ret: 0, msgs, buf };
}

/** What the bridge sends back, in order. */
export interface SentMessage {
	to: string;
	text: string;
	contextToken?: string;
}

export interface FakeWechatClient {
	/** Pass as the extension's `createClient` dep. */
	createClient: (options: WechatClientOptions) => WechatClient;
	/** Pass as the extension's `sleep` dep: parks the loop until it aborts. */
	sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
	/** How many clients the extension built; one open bridge means one. */
	clients: () => number;
	/** Every `sendMessage`, in order. */
	sent: SentMessage[];
	/** How many polls actually reached the transport. */
	polls: () => number;
	/** How many parked polls were aborted, so a closed loop is observable. */
	aborts: () => number;
}

/**
 * A `WechatClient` double. Each `started` response in `script` is returned by
 * the next poll; after the script runs out the poll parks until the loop is
 * aborted, so a test never spins and never touches a timer. `getConfig`
 * answers without a typing ticket, which keeps the typing indicator out of the
 * way.
 */
export function fakeWechatClient(script: UpdatesResponse[] = []): FakeWechatClient {
	const queue = [...script];
	const sent: SentMessage[] = [];
	let clients = 0;
	let polls = 0;
	let aborts = 0;

	const client: Partial<WechatClient> = {
		async getUpdates(_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> {
			if (signal?.aborted) throw new Error("aborted");
			polls += 1;
			const next = queue.shift();
			if (next) return next;
			// Park like a long poll, so a test observes the loop closing instead of a spin.
			await new Promise<void>((resolve) => {
				if (!signal) return resolve();
				signal.addEventListener(
					"abort",
					() => {
						aborts += 1;
						resolve();
					},
					{ once: true },
				);
			});
			throw new Error("aborted");
		},
		async sendMessage(
			_account: BotCredentials,
			args: { to: string; text: string; contextToken?: string },
		): Promise<{ ret: number }> {
			sent.push({ to: args.to, text: args.text, contextToken: args.contextToken });
			return { ret: 0 };
		},
		async getConfig(): Promise<{ ret: number }> {
			return { ret: 0 };
		},
	};

	return {
		createClient: (_options: WechatClientOptions) => {
			clients += 1;
			return client as WechatClient;
		},
		sleep: async (_ms: number, signal?: AbortSignal) => {
			if (!signal) return;
			await aborted(signal);
			throw new Error("aborted");
		},
		clients: () => clients,
		sent,
		polls: () => polls,
		aborts: () => aborts,
	};
}

/** Write a stored account, as a previous `/wechat login` would. */
export function writeAccount(dir: string, account: BotCredentials = ACCOUNT): BotCredentials {
	const wechat = join(dir, "wechat");
	mkdirSync(wechat, { recursive: true });
	writeFileSync(
		join(wechat, "credentials.json"),
		`${JSON.stringify({ accounts: { [account.ilinkBotId || account.ilinkUserId]: account } }, null, 2)}\n`,
		"utf-8",
	);
	return account;
}

/** Resolve when `signal` aborts; resolve at once when there is none. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) return Promise.resolve();
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
