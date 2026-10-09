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
		expect(JSON.parse(String(calls[0]?.body ?? "{}"))).toEqual({ local_token_list: [] });
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
		const body = JSON.parse(String(calls[0]?.body ?? "{}"));
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
		const msg = JSON.parse(String(calls[0]?.body ?? "{}")).msg;
		expect(msg.to_user_id).toBe("peer");
		expect(msg.message_type).toBe(2);
		expect(msg.context_token).toBe("ctx");
		expect(msg.item_list[0]).toEqual({ type: 1, text_item: { text: "hi" } });
	});
});

describe("getUploadUrl", () => {
	test("posts the file metadata and returns the upload target", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0, upload_param: "p" })]);
		const result = await client(http).getUploadUrl(account, {
			filekey: "ff00",
			mediaType: 3,
			toUserId: "peer",
			rawsize: 10,
			rawfilemd5: "abc",
			filesize: 16,
			aeskey: "0011",
		});
		expect(calls[0]?.url).toBe("https://base/ilink/bot/getuploadurl");
		expect(calls[0]?.headers?.Authorization).toBe("Bearer tok");
		const body = JSON.parse(String(calls[0]?.body ?? "{}"));
		expect(body).toMatchObject({
			filekey: "ff00",
			media_type: 3,
			to_user_id: "peer",
			rawsize: 10,
			rawfilemd5: "abc",
			filesize: 16,
			no_need_thumb: true,
			aeskey: "0011",
		});
		expect(body.base_info).toEqual({ channel_version: "0.1.0", bot_agent: "ag" });
		expect(result).toEqual({ uploadParam: "p", uploadFullUrl: undefined });
	});
});

describe("sendFileMessage", () => {
	test("builds a file item with the media reference", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0 })]);
		await client(http).sendFileMessage(account, {
			to: "peer",
			fileName: "plan.md",
			len: "123",
			media: { encrypt_query_param: "qp", aes_key: "a2V5", encrypt_type: 1 },
			contextToken: "ctx",
		});
		const msg = JSON.parse(String(calls[0]?.body ?? "{}")).msg;
		expect(msg.to_user_id).toBe("peer");
		expect(msg.message_type).toBe(2);
		expect(msg.context_token).toBe("ctx");
		expect(msg.item_list[0]).toEqual({
			type: 4,
			file_item: {
				media: { encrypt_query_param: "qp", aes_key: "a2V5", encrypt_type: 1 },
				file_name: "plan.md",
				len: "123",
			},
		});
	});
});

describe("getConfig", () => {
	test("posts the user id and returns the typing ticket", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0, typing_ticket: "ticket" })]);
		const result = await client(http).getConfig(account, { ilinkUserId: "u", contextToken: "ctx" });
		expect(calls[0]?.url).toBe("https://base/ilink/bot/getconfig");
		expect(calls[0]?.headers?.Authorization).toBe("Bearer tok");
		const body = JSON.parse(String(calls[0]?.body ?? "{}"));
		expect(body.ilink_user_id).toBe("u");
		expect(body.context_token).toBe("ctx");
		expect(result.typingTicket).toBe("ticket");
	});
});

describe("sendTyping", () => {
	test("maps the typing boolean to status 1 and 2", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0 }), jsonResponse({ ret: 0 })]);
		await client(http).sendTyping(account, { ilinkUserId: "u", typingTicket: "t", typing: true });
		await client(http).sendTyping(account, { ilinkUserId: "u", typingTicket: "t", typing: false });
		expect(calls[0]?.url).toBe("https://base/ilink/bot/sendtyping");
		expect(JSON.parse(String(calls[0]?.body ?? "{}")).status).toBe(1);
		expect(JSON.parse(String(calls[1]?.body ?? "{}")).status).toBe(2);
	});
});

describe("downloadCdn", () => {
	test("GETs the full URL and returns bytes", async () => {
		const { calls, http } = recorder([{ status: 200, headers: {}, text: "", bytes: new Uint8Array([1, 2]) }]);
		const bytes = await client(http).downloadCdn({ full_url: "https://cdn/f" });
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toBe("https://cdn/f");
		expect(calls[0]?.responseType).toBe("binary");
		expect(bytes).toEqual(new Uint8Array([1, 2]));
	});

	test("throws on a non-success status", async () => {
		const { http } = recorder([{ status: 404, headers: {}, text: "" }]);
		await expect(client(http).downloadCdn({ encrypt_query_param: "p" }, undefined)).rejects.toBeInstanceOf(WechatError);
	});
});

describe("uploadCdn", () => {
	test("POSTs the bytes as octet-stream and returns x-encrypted-param", async () => {
		const { calls, http } = recorder([{ status: 200, headers: { "x-encrypted-param": "dl" }, text: "" }]);
		const param = await client(http).uploadCdn("https://cdn/upload?x=1", new Uint8Array([1, 2, 3]));
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers?.["Content-Type"]).toBe("application/octet-stream");
		expect(calls[0]?.body).toEqual(new Uint8Array([1, 2, 3]));
		expect(param).toBe("dl");
	});

	test("aborts immediately on a 4xx", async () => {
		const { calls, http } = recorder([{ status: 403, headers: {}, text: "" }]);
		await expect(client(http).uploadCdn("https://cdn/u", new Uint8Array(), undefined)).rejects.toBeInstanceOf(
			WechatError,
		);
		expect(calls).toHaveLength(1);
	});

	test("retries a 5xx up to three attempts", async () => {
		const { calls, http } = recorder([
			{ status: 500, headers: {}, text: "" },
			{ status: 500, headers: {}, text: "" },
			{ status: 200, headers: { "x-encrypted-param": "ok" }, text: "" },
		]);
		const param = await client(http).uploadCdn("https://cdn/u", new Uint8Array([9]));
		expect(param).toBe("ok");
		expect(calls).toHaveLength(3);
	});

	test("throws after three failed attempts", async () => {
		const responses = [0, 1, 2].map(() => ({ status: 500, headers: {}, text: "" }));
		const { calls, http } = recorder(responses);
		await expect(client(http).uploadCdn("https://cdn/u", new Uint8Array())).rejects.toBeInstanceOf(WechatError);
		expect(calls).toHaveLength(3);
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
