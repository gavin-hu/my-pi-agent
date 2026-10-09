/**
 * The Weixin iLink bot HTTP client.
 *
 * Only the endpoints the bridge needs: QR login (`get_bot_qrcode` /
 * `get_qrcode_status`), long-poll receive (`getupdates`), and send
 * (`sendmessage`). The HTTP runner is injected so tests never touch the network.
 *
 * See `Tencent/openclaw-weixin` `docs/protocol.md` for the wire contract.
 */

import { randomUUID } from "node:crypto";
import type { BotCredentials, QrResponse, QrStatus, SendResponse, UpdatesResponse, WeixinMessage } from "./types.ts";

/** Fixed public API base used for QR login. */
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
/** Application id sent as `iLink-App-Id`. */
export const APP_ID = "bot";
/** `ret`/`errcode` value meaning the bot token expired and login is required. */
export const SESSION_EXPIRED = -14;

export interface HttpRequest {
	url: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
}

/** The HTTP seam; defaults to `fetch`, injected in tests. */
export type HttpRunner = (request: HttpRequest) => Promise<HttpResponse>;

/** An error from the Weixin backend or transport, safe to show the user. */
export class WechatError extends Error {
	readonly status?: number;
	readonly code?: number;

	constructor(message: string, options: { status?: number; code?: number } = {}) {
		super(message);
		this.name = "WechatError";
		this.status = options.status;
		this.code = options.code;
	}
}

/** Build an `HttpRunner` backed by `fetch`. */
export function createFetchRunner(fetchImpl: typeof fetch = fetch): HttpRunner {
	return async (request) => {
		const response = await fetchImpl(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			signal: request.signal,
		});
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
		return { status: response.status, headers, text: await response.text() };
	};
}

/** Encode a `MAJOR.MINOR.PATCH` version as `0x00MMNNPP`, decimal. */
export function encodeClientVersion(version: string): string {
	const [major = 0, minor = 0, patch = 0] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const value = (((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)) >>> 0;
	return String(value);
}

/** Base64 of the decimal string for a random uint32. */
export function encodeUin(random: () => number): string {
	const value = Math.floor(random() * 0xffffffff) >>> 0;
	return Buffer.from(String(value), "utf-8").toString("base64");
}

export interface WechatClientOptions {
	http: HttpRunner;
	channelVersion: string;
	botAgent: string;
	/** Random source for `X-WECHAT-UIN`; defaults to `Math.random`. */
	random?: () => number;
	/** Base URL for QR requests; defaults to {@link DEFAULT_BASE_URL}. */
	baseUrl?: string;
}

function parseJson(text: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(text);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function toMessages(value: unknown): WeixinMessage[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is WeixinMessage => !!entry && typeof entry === "object");
}

/** A single-account iLink client. */
export class WechatClient {
	private readonly http: HttpRunner;
	private readonly channelVersion: string;
	private readonly botAgent: string;
	private readonly random: () => number;
	private readonly baseUrl: string;

	constructor(options: WechatClientOptions) {
		this.http = options.http;
		this.channelVersion = options.channelVersion;
		this.botAgent = options.botAgent;
		this.random = options.random ?? Math.random;
		this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
	}

	private baseInfo(): Record<string, string> {
		return { channel_version: this.channelVersion, bot_agent: this.botAgent };
	}

	private appHeaders(): Record<string, string> {
		return {
			"iLink-App-Id": APP_ID,
			"iLink-App-ClientVersion": encodeClientVersion(this.channelVersion),
		};
	}

	private jsonMetaHeaders(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			AuthorizationType: "ilink_bot_token",
			"X-WECHAT-UIN": encodeUin(this.random),
			...this.appHeaders(),
		};
	}

	private authHeaders(account: BotCredentials): Record<string, string> {
		return {
			...this.jsonMetaHeaders(),
			Authorization: `Bearer ${account.botToken}`,
		};
	}

	private async post(
		url: string,
		headers: Record<string, string>,
		body: unknown,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		const response = await this.http({ url, method: "POST", headers, body: JSON.stringify(body), signal });
		if (response.status < 200 || response.status >= 300) {
			throw new WechatError(`Weixin backend returned HTTP ${response.status}.`, { status: response.status });
		}
		return parseJson(response.text);
	}

	/** `POST /ilink/bot/get_bot_qrcode` — start a login. */
	async fetchQr(): Promise<QrResponse> {
		const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`;
		const data = await this.post(url, this.jsonMetaHeaders(), { local_token_list: [] });
		const qrcode = asString(data.qrcode);
		const imgContent = asString(data.qrcode_img_content);
		if (!qrcode || !imgContent) throw new WechatError("Weixin login did not return a QR code.");
		return { qrcode, imgContent };
	}

	/** `GET /ilink/bot/get_qrcode_status` — poll a login. */
	async pollQrStatus(qrcode: string, verifyCode?: string, signal?: AbortSignal): Promise<QrStatus> {
		let url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
		if (verifyCode) url += `&verify_code=${encodeURIComponent(verifyCode)}`;
		const response = await this.http({ url, method: "GET", headers: this.appHeaders(), signal });
		if (response.status < 200 || response.status >= 300) {
			throw new WechatError(`Weixin backend returned HTTP ${response.status}.`, { status: response.status });
		}
		const data = parseJson(response.text);
		return {
			status: asString(data.status) ?? "wait",
			botToken: asString(data.bot_token),
			ilinkBotId: asString(data.ilink_bot_id),
			baseUrl: asString(data.baseurl),
			ilinkUserId: asString(data.ilink_user_id),
		};
	}

	/** `POST /ilink/bot/getupdates` — long-poll for inbound messages. */
	async getUpdates(account: BotCredentials, cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> {
		const url = `${account.baseUrl}/ilink/bot/getupdates`;
		const data = await this.post(
			url,
			this.authHeaders(account),
			{ get_updates_buf: cursor, base_info: this.baseInfo() },
			signal,
		);
		return {
			ret: asNumber(data.ret),
			errcode: asNumber(data.errcode),
			msgs: toMessages(data.msgs),
			buf: asString(data.get_updates_buf) ?? "",
			timeoutMs: asNumber(data.longpolling_timeout_ms),
		};
	}

	/** `POST /ilink/bot/sendmessage` — send one text message. */
	async sendMessage(
		account: BotCredentials,
		args: { to: string; text: string; contextToken?: string },
		signal?: AbortSignal,
	): Promise<SendResponse> {
		const url = `${account.baseUrl}/ilink/bot/sendmessage`;
		const msg: Record<string, unknown> = {
			from_user_id: "",
			to_user_id: args.to,
			client_id: randomUUID(),
			message_type: 2,
			message_state: 2,
			item_list: [{ type: 1, text_item: { text: args.text } }],
		};
		if (args.contextToken) msg.context_token = args.contextToken;
		const data = await this.post(url, this.authHeaders(account), { msg, base_info: this.baseInfo() }, signal);
		return { ret: asNumber(data.ret), errcode: asNumber(data.errcode) };
	}
}

/** True when a response reports an expired bot token. */
export function isSessionExpired(response: { ret?: number; errcode?: number }): boolean {
	return response.ret === SESSION_EXPIRED || response.errcode === SESSION_EXPIRED;
}
