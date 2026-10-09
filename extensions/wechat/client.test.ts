import { describe, expect, test } from "bun:test";
import {
	encodeClientVersion,
	encodeUin,
	type HttpRequest,
	type HttpResponse,
	type HttpRunner,
	isSessionExpired,
	WechatClient,
	WechatError,
} from "./client.ts";
import type { BotCredentials } from "./types.ts";

const account: BotCredentials = {
	botToken: "tok",
	ilinkUserId: "u",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function recorder(responses: HttpResponse[]): { calls: HttpRequest[]; http: HttpRunner } {
	const calls: HttpRequest[] = [];
	const http: HttpRunner = async (request) => {
		calls.push(request);
		const next = responses.shift();
		if (!next) throw new Error("no scripted response");
		return next;
	};
	return { calls, http };
}

function jsonResponse(body: unknown, status = 200): HttpResponse {
	return { status, headers: {}, text: JSON.stringify(body) };
}

function client(http: HttpRunner): WechatClient {
	return new WechatClient({ http, channelVersion: "0.1.0", botAgent: "ag", random: () => 0 });
}

describe("version and uin encoding", () => {
	test("encodes the plugin version as 0x00MMNNPP", () => {
		expect(encodeClientVersion("0.1.0")).toBe("256");
		expect(encodeClientVersion("2.4.8")).toBe("132104");
	});

	test("base64-encodes a random uint32", () => {
		expect(encodeUin(() => 0)).toBe("MA==");
	});
});

describe("fetchQr", () => {
	test("posts to get_bot_qrcode with application headers", async () => {
		const { calls, http } = recorder([jsonResponse({ qrcode: "Q", qrcode_img_content: "https://x" })]);
		const result = await client(http).fetchQr();
		expect(result).toEqual({ qrcode: "Q", imgContent: "https://x" });
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toContain("/ilink/bot/get_bot_qrcode?bot_type=3");
		expect(calls[0]?.headers?.AuthorizationType).toBe("ilink_bot_token");
		expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ local_token_list: [] });
	});

	test("throws when the response has no QR", async () => {
		const { http } = recorder([jsonResponse({})]);
		await expect(client(http).fetchQr()).rejects.toBeInstanceOf(WechatError);
	});
});

describe("getUpdates", () => {
	test("authorizes, sends the cursor, and parses messages", async () => {
		const { calls, http } = recorder([
			jsonResponse({ ret: 0, msgs: [{ from_user_id: "u" }], get_updates_buf: "c2", longpolling_timeout_ms: 700 }),
		]);
		const response = await client(http).getUpdates(account, "c1");
		expect(calls[0]?.url).toBe("https://base/ilink/bot/getupdates");
		expect(calls[0]?.headers?.Authorization).toBe("Bearer tok");
		const body = JSON.parse(calls[0]?.body ?? "{}");
		expect(body.get_updates_buf).toBe("c1");
		expect(body.base_info).toEqual({ channel_version: "0.1.0", bot_agent: "ag" });
		expect(response.msgs).toHaveLength(1);
		expect(response.buf).toBe("c2");
		expect(response.timeoutMs).toBe(700);
	});
});

describe("sendMessage", () => {
	test("builds a text message with the reply token", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0 })]);
		await client(http).sendMessage(account, { to: "peer", text: "hi", contextToken: "ctx" });
		const msg = JSON.parse(calls[0]?.body ?? "{}").msg;
		expect(msg.to_user_id).toBe("peer");
		expect(msg.message_type).toBe(2);
		expect(msg.context_token).toBe("ctx");
		expect(msg.item_list[0]).toEqual({ type: 1, text_item: { text: "hi" } });
	});
});

describe("transport errors", () => {
	test("throws on a non-success status", async () => {
		const { http } = recorder([{ status: 500, headers: {}, text: "" }]);
		await expect(client(http).fetchQr()).rejects.toBeInstanceOf(WechatError);
	});

	test("detects an expired session", () => {
		expect(isSessionExpired({ ret: -14 })).toBe(true);
		expect(isSessionExpired({ errcode: -14 })).toBe(true);
		expect(isSessionExpired({ ret: 0 })).toBe(false);
	});
});
