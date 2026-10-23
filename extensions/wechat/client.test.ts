/**
 * The bridge's wire and storage half: the iLink client, the QR login state
 * machine and screen, stored credentials, media encode/decode, outbound file
 * upload, and read-only peer history.
 *
 * Every seam is injected — the HTTP runner, the clock, the sleep, the random
 * source, and the filesystem root — so nothing here touches the network, a real
 * timer, or a real session.
 */

import { createCipheriv, createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { clearCredentials, primaryAccount, readCredentials, saveAccount, writeCredentials } from "./credentials.ts";
import {
	encodeClientVersion,
	encodeUin,
	type HttpRequest,
	type HttpResponse,
	type HttpRunner,
	isSessionExpired,
	rejectionOf,
	WechatClient,
	WechatError,
} from "./client.ts";
import { formatHistory, HISTORY_LINE_CHARS, readPeerHistory } from "./history.ts";
import { classifyStatus, credentialsFromStatus, type LoginOptions, type StatusKind, waitForLogin } from "./login.ts";
import { LoginScreenComponent, loginBody, statusLabel } from "./login-screen.ts";
import {
	aesEcbPaddedSize,
	buildUploadUrl,
	decodeMediaKey,
	decryptEcb,
	encryptEcb,
	mediaDownloadUrl,
	sanitizeFileName,
	saveMedia,
	sniffImageMime,
	uploadUrlOf,
} from "./media.ts";
import { sendLocalFile, UPLOAD_MEDIA_TYPE_FILE } from "./outbound.ts";
import { peerSessionDir } from "./peer-session.ts";
import { qrLines, qrMatrix } from "../../lib/qr.ts";
import type { BotCredentials, QrResponse, QrStatus } from "./types.ts";

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
	test("encodes a MAJOR.MINOR.PATCH version as 0x00MMNNPP", () => {
		expect(encodeClientVersion("0.1.0")).toBe("256");
		expect(encodeClientVersion("2.4.8")).toBe("132104");
	});

	test("base64-encodes a random uint32", () => {
		expect(encodeUin(() => 0)).toBe("MA==");
	});
});

describe("QR login requests", () => {
	test("fetchQr posts to get_bot_qrcode with the application headers", async () => {
		const { calls, http } = recorder([jsonResponse({ qrcode: "Q", qrcode_img_content: "https://x" })]);
		const result = await client(http).fetchQr();
		expect(result).toEqual({ qrcode: "Q", imgContent: "https://x" });
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toContain("/ilink/bot/get_bot_qrcode?bot_type=3");
		expect(calls[0]?.headers?.AuthorizationType).toBe("ilink_bot_token");
		expect(JSON.parse(String(calls[0]?.body ?? "{}"))).toEqual({ local_token_list: [] });
	});

	test("fetchQr throws when the response has no QR", async () => {
		const { http } = recorder([jsonResponse({})]);
		await expect(client(http).fetchQr()).rejects.toBeInstanceOf(WechatError);
	});

	test("pollQrStatus GETs the status and appends the verification code", async () => {
		const { calls, http } = recorder([jsonResponse({ status: "need_verifycode", ilink_user_id: "u" })]);
		const status = await client(http).pollQrStatus("Q", "1234");
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toContain("/ilink/bot/get_qrcode_status?qrcode=Q&verify_code=1234");
		expect(status.status).toBe("need_verifycode");
		expect(status.ilinkUserId).toBe("u");
	});

	test("pollQrStatus defaults an unrecognized body to wait", async () => {
		const { http } = recorder([jsonResponse({})]);
		expect((await client(http).pollQrStatus("Q")).status).toBe("wait");
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
		// The hold is not requested unless configured: the server's own is the default.
		expect(body.longpolling_timeout_ms).toBeUndefined();
	});

	test("asks for a shorter hold only when one is configured", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0, msgs: [], get_updates_buf: "c2" })]);
		await client(http).getUpdates(account, "c1", undefined, { holdMs: 3000 });
		expect(JSON.parse(String(calls[0]?.body ?? "{}")).longpolling_timeout_ms).toBe(3000);
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

	test("surfaces the server's description of a rejected send", async () => {
		const { http } = recorder([jsonResponse({ ret: -2, errmsg: "context token invalid" })]);
		const response = await client(http).sendMessage(account, { to: "peer", text: "hi" });
		expect(response.ret).toBe(-2);
		expect(response.errmsg).toBe("context token invalid");
	});
});

describe("file upload and send", () => {
	test("getUploadUrl posts the file metadata and returns the upload target", async () => {
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

	test("sendFileMessage builds a file item with the media reference", async () => {
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

describe("typing indicator", () => {
	test("getConfig posts the user id and returns the typing ticket", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0, typing_ticket: "ticket" })]);
		const result = await client(http).getConfig(account, { ilinkUserId: "u", contextToken: "ctx" });
		expect(calls[0]?.url).toBe("https://base/ilink/bot/getconfig");
		expect(calls[0]?.headers?.Authorization).toBe("Bearer tok");
		const body = JSON.parse(String(calls[0]?.body ?? "{}"));
		expect(body.ilink_user_id).toBe("u");
		expect(body.context_token).toBe("ctx");
		expect(result.typingTicket).toBe("ticket");
	});

	test("sendTyping maps the typing boolean to status 1 and 2", async () => {
		const { calls, http } = recorder([jsonResponse({ ret: 0 }), jsonResponse({ ret: 0 })]);
		await client(http).sendTyping(account, { ilinkUserId: "u", typingTicket: "t", typing: true });
		await client(http).sendTyping(account, { ilinkUserId: "u", typingTicket: "t", typing: false });
		expect(calls[0]?.url).toBe("https://base/ilink/bot/sendtyping");
		expect(JSON.parse(String(calls[0]?.body ?? "{}")).status).toBe(1);
		expect(JSON.parse(String(calls[1]?.body ?? "{}")).status).toBe(2);
	});
});

describe("CDN transport", () => {
	test("downloadCdn GETs the full URL and returns bytes", async () => {
		const { calls, http } = recorder([{ status: 200, headers: {}, text: "", bytes: new Uint8Array([1, 2]) }]);
		const bytes = await client(http).downloadCdn({ full_url: "https://cdn/f" });
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.url).toBe("https://cdn/f");
		expect(calls[0]?.responseType).toBe("binary");
		expect(bytes).toEqual(new Uint8Array([1, 2]));
	});

	test("downloadCdn throws on a non-success status", async () => {
		const { http } = recorder([{ status: 404, headers: {}, text: "" }]);
		await expect(client(http).downloadCdn({ encrypt_query_param: "p" })).rejects.toBeInstanceOf(WechatError);
	});

	test("uploadCdn POSTs the bytes as octet-stream and returns x-encrypted-param", async () => {
		const { calls, http } = recorder([{ status: 200, headers: { "x-encrypted-param": "dl" }, text: "" }]);
		const param = await client(http).uploadCdn("https://cdn/upload?x=1", new Uint8Array([1, 2, 3]));
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers?.["Content-Type"]).toBe("application/octet-stream");
		expect(calls[0]?.body).toEqual(new Uint8Array([1, 2, 3]));
		expect(param).toBe("dl");
	});

	test("uploadCdn aborts immediately on a 4xx", async () => {
		const { calls, http } = recorder([{ status: 403, headers: {}, text: "" }]);
		await expect(client(http).uploadCdn("https://cdn/u", new Uint8Array())).rejects.toBeInstanceOf(WechatError);
		expect(calls).toHaveLength(1);
	});

	test("uploadCdn retries a 5xx and succeeds within three attempts", async () => {
		const { calls, http } = recorder([
			{ status: 500, headers: {}, text: "" },
			{ status: 500, headers: {}, text: "" },
			{ status: 200, headers: { "x-encrypted-param": "ok" }, text: "" },
		]);
		const param = await client(http).uploadCdn("https://cdn/u", new Uint8Array([9]));
		expect(param).toBe("ok");
		expect(calls).toHaveLength(3);
	});

	test("uploadCdn throws after three failed attempts", async () => {
		const responses = [0, 1, 2].map(() => ({ status: 500, headers: {}, text: "" }));
		const { calls, http } = recorder(responses);
		await expect(client(http).uploadCdn("https://cdn/u", new Uint8Array())).rejects.toBeInstanceOf(WechatError);
		expect(calls).toHaveLength(3);
	});
});

describe("transport and body rejections", () => {
	test("a non-success HTTP status throws", async () => {
		const { http } = recorder([{ status: 500, headers: {}, text: "" }]);
		await expect(client(http).fetchQr()).rejects.toBeInstanceOf(WechatError);
	});

	test("isSessionExpired recognizes the expired-token code on either field", () => {
		expect(isSessionExpired({ ret: -14 })).toBe(true);
		expect(isSessionExpired({ errcode: -14 })).toBe(true);
		expect(isSessionExpired({ ret: 0 })).toBe(false);
	});

	test("rejectionOf accepts a response with no code, or a zero one", () => {
		expect(rejectionOf({})).toBeUndefined();
		expect(rejectionOf({ ret: 0 })).toBeUndefined();
		expect(rejectionOf({ ret: 0, errcode: 0 })).toBeUndefined();
	});

	test("rejectionOf reports a non-zero ret with its description", () => {
		expect(rejectionOf({ ret: -2, errmsg: "context token invalid" })).toEqual({
			code: -2,
			detail: "context token invalid",
		});
		// A code with no description still reports the code.
		expect(rejectionOf({ ret: -2 })).toEqual({ code: -2, detail: undefined });
	});

	test("rejectionOf reports errcode when ret is absent or zero", () => {
		expect(rejectionOf({ errcode: 45009 })).toEqual({ code: 45009, detail: undefined });
		// The body can carry `ret: 0` beside a real errcode; reporting ret 0 would hide
		// the reason.
		expect(rejectionOf({ ret: 0, errcode: -2, errmsg: "bad token" })).toEqual({ code: -2, detail: "bad token" });
	});

	test("rejectionOf prefers ret when both are set", () => {
		expect(rejectionOf({ ret: -1, errcode: -2 })?.code).toBe(-1);
	});
});

describe("stored credentials", () => {
	const second: BotCredentials = {
		botToken: "tok2",
		ilinkUserId: "other@im.wechat",
		ilinkBotId: "b2",
		baseUrl: "https://other",
		botAgent: "pi-wechat",
		createdAt: 6,
	};

	function newPath(): string {
		return join(tempDir("wechat-cred-"), "credentials.json");
	}

	test("round-trip an account keyed by bot id", () => {
		const path = newPath();
		saveAccount(account, path);
		expect(primaryAccount(path)).toEqual(account);
	});

	test("makes the last confirmed login the active account", () => {
		const path = newPath();
		saveAccount(account, path);
		saveAccount(second, path);
		// Both stay stored (multi-account), but the bridge must run the new one.
		expect(Object.keys(readCredentials(path).accounts)).toEqual(["b", "b2"]);
		expect(primaryAccount(path)).toEqual(second);
	});

	test("switches to an account that is not the first stored one", () => {
		const third: BotCredentials = { ...account, ilinkBotId: "b3", ilinkUserId: "third@im.wechat" };
		const path = newPath();
		saveAccount(account, path);
		saveAccount(second, path);
		saveAccount(third, path);
		saveAccount(second, path);
		// The first account is not the one that just logged in, so a first-only read
		// would still return `account` here.
		expect(primaryAccount(path)).toEqual(second);
	});

	test("falls back to the first account for a file written before activeAccount", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account, b2: second } }), "utf-8");
		expect(readCredentials(path).activeAccount).toBeUndefined();
		expect(primaryAccount(path)).toEqual(account);
	});

	test("ignores an active pointer to an account that is not stored", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { b: account }, activeAccount: "gone" }), "utf-8");
		expect(readCredentials(path).activeAccount).toBeUndefined();
		expect(primaryAccount(path)).toEqual(account);
	});

	test("drops malformed entries on read", () => {
		const path = newPath();
		writeFileSync(path, JSON.stringify({ accounts: { bad: { botToken: "" }, good: account } }), "utf-8");
		expect(primaryAccount(path)).toEqual(account);
		expect(Object.keys(readCredentials(path).accounts)).toEqual(["good"]);
	});

	test("returns no accounts for a corrupt file", () => {
		const path = newPath();
		writeFileSync(path, "not json", "utf-8");
		expect(readCredentials(path).accounts).toEqual({});
	});

	test("clears every account on logout", () => {
		const path = newPath();
		saveAccount(account, path);
		clearCredentials(path);
		expect(readCredentials(path)).toEqual({ accounts: {} });
	});

	test.skipIf(process.platform === "win32")("writes the file with mode 0600", () => {
		const path = newPath();
		writeCredentials(path, { accounts: { b: account } });
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});

describe("login state machine", () => {
	const qr: QrResponse = { qrcode: "Q", imgContent: "url" };

	function fakeClient(statuses: QrStatus[]): { client: WechatClient; seen: Array<{ verify?: string }> } {
		let index = 0;
		const seen: Array<{ verify?: string }> = [];
		const fake = {
			pollQrStatus: async (_qrcode: string, verify?: string) => {
				seen.push({ verify });
				const value = statuses[Math.min(index, statuses.length - 1)];
				index += 1;
				return value;
			},
		} as unknown as WechatClient;
		return { client: fake, seen };
	}

	function options(overrides: Partial<LoginOptions> = {}): LoginOptions {
		return { botAgent: "ag", now: () => 1000, sleep: async () => {}, ...overrides };
	}

	test("classifyStatus maps each documented status and treats an unknown one as pending", () => {
		const cases: Array<[string, StatusKind]> = [
			["wait", "pending"],
			["scaned", "pending"],
			["confirmed", "confirmed"],
			["expired", "expired"],
			["need_verifycode", "verify"],
			["verify_code_blocked", "blocked"],
			["binded_redirect", "binded"],
			["unknown", "pending"],
		];
		for (const [input, expected] of cases) expect(classifyStatus(input)).toBe(expected);
	});

	test("credentialsFromStatus builds a complete account and refuses an incomplete one", () => {
		expect(
			credentialsFromStatus(
				{ status: "confirmed", botToken: "t", ilinkUserId: "u", ilinkBotId: "b", baseUrl: "https://x" },
				"ag",
				1000,
			),
		).toEqual({
			botToken: "t",
			ilinkUserId: "u",
			ilinkBotId: "b",
			baseUrl: "https://x",
			botAgent: "ag",
			createdAt: 1000,
		});
		expect(credentialsFromStatus({ status: "confirmed", botToken: "t" }, "ag", 1000)).toBeUndefined();
	});

	test("returns the account when the login is confirmed", async () => {
		const { client: fake } = fakeClient([
			{ status: "confirmed", botToken: "t", ilinkUserId: "u", ilinkBotId: "b", baseUrl: "https://x" },
		]);
		expect(await waitForLogin(fake, qr, options())).toEqual({
			kind: "confirmed",
			account: {
				botToken: "t",
				ilinkUserId: "u",
				ilinkBotId: "b",
				baseUrl: "https://x",
				botAgent: "ag",
				createdAt: 1000,
			},
		});
	});

	test("enters a verification code and retries", async () => {
		const { client: fake, seen } = fakeClient([
			{ status: "need_verifycode" },
			{ status: "confirmed", botToken: "t", ilinkUserId: "u" },
		]);
		const outcome = await waitForLogin(fake, qr, options({ requestVerifyCode: async () => "1234" }));
		expect(outcome.kind).toBe("confirmed");
		expect(seen[1]?.verify).toBe("1234");
	});

	test("cancels when no verification code is provided", async () => {
		const { client: fake } = fakeClient([{ status: "need_verifycode" }]);
		expect(await waitForLogin(fake, qr, options({ requestVerifyCode: async () => undefined }))).toEqual({
			kind: "cancelled",
		});
	});

	test("reports when the server asks for a code with no way to enter one", async () => {
		const { client: fake } = fakeClient([{ status: "need_verifycode" }]);
		const outcome = await waitForLogin(fake, qr, options());
		expect(outcome.kind).toBe("error");
		expect(outcome.kind === "error" ? outcome.message : "").toContain("verification code");
	});

	test("reports an expired QR", async () => {
		const { client: fake } = fakeClient([{ status: "expired" }]);
		expect(await waitForLogin(fake, qr, options())).toEqual({ kind: "expired" });
	});

	test("reports a blocked QR and an already-bound account", async () => {
		const blocked = await waitForLogin(fakeClient([{ status: "verify_code_blocked" }]).client, qr, options());
		expect(blocked.kind).toBe("error");
		const binded = await waitForLogin(fakeClient([{ status: "binded_redirect" }]).client, qr, options());
		expect(binded.kind).toBe("error");
	});

	test("reports a poll failure instead of looping", async () => {
		const failing = {
			pollQrStatus: async () => {
				throw new Error("network down");
			},
		} as unknown as WechatClient;
		const outcome = await waitForLogin(failing, qr, options());
		expect(outcome).toEqual({ kind: "error", message: "network down" });
	});

	test("cancels when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { client: fake } = fakeClient([{ status: "wait" }]);
		expect(await waitForLogin(fake, qr, options({ signal: controller.signal }))).toEqual({ kind: "cancelled" });
	});
});

describe("login screen", () => {
	test("statusLabel maps a known status and passes an unknown one through", () => {
		expect(statusLabel("wait")).toContain("Waiting");
		expect(statusLabel("mystery")).toBe("mystery");
	});

	test("loginBody shows the QR when it fits the width", () => {
		const body = loginBody({ status: "wait", lines: ["██", "██"], url: "" }, 10);
		expect(body).toContain("██");
	});

	test("loginBody falls back to URL chunks when the QR is too wide", () => {
		const body = loginBody({ status: "wait", lines: ["XXXXX"], url: "abcdefgh" }, 4);
		expect(body).toContain("abcd");
		expect(body).toContain("efgh");
	});

	test("loginBody shows an error instead of the status", () => {
		expect(loginBody({ status: "wait", lines: [], url: "", error: "boom" }, 20)).toContain("boom");
	});

	test("the screen calls onCancel on escape", () => {
		let cancelled = false;
		const component = new LoginScreenComponent({
			theme: fakeTheme,
			state: () => ({ status: "wait", lines: [], url: "" }),
			onCancel: () => {
				cancelled = true;
			},
			requestRender: () => {},
		});
		component.handleInput("\u001b");
		expect(cancelled).toBe(true);
	});

	test("the screen keeps every rendered line inside the width", () => {
		const component = new LoginScreenComponent({
			theme: fakeTheme,
			state: () => ({ status: "wait", lines: ["██"], url: "" }),
			onCancel: () => {},
			requestRender: () => {},
		});
		for (const line of component.render(12)) expect(visibleWidth(line)).toBeLessThanOrEqual(12);
	});
});

describe("QR terminal lines", () => {
	test("returns equal-width lines sized to the matrix plus the quiet zone", async () => {
		const lines = await qrLines("hello", { quiet: 2 });
		const width = (await qrMatrix("hello")).size + 4;
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line.length).toBe(width);
	});

	test("uses only half-block and space characters", async () => {
		for (const line of await qrLines("https://example.com/login")) {
			expect(/^[█▀▄ ]*$/.test(line)).toBe(true);
		}
	});
});

describe("media encoding", () => {
	test("decodeMediaKey reads a 32-character hex key", () => {
		expect(decodeMediaKey("00112233445566778899aabbccddeeff")).toEqual(
			Buffer.from("00112233445566778899aabbccddeeff", "hex"),
		);
	});

	test("decodeMediaKey reads a base64 key", () => {
		const raw = Buffer.from("0123456789abcdef");
		expect(decodeMediaKey(raw.toString("base64"))).toEqual(raw);
	});

	test("decodeMediaKey rejects a key that is not 16 bytes", () => {
		expect(() => decodeMediaKey("abcd")).toThrow();
	});

	test("decryptEcb round-trips AES-128-ECB with PKCS#7 padding", () => {
		const key = Buffer.from("0123456789abcdef");
		const plaintext = Buffer.from("wechat media payload");
		const cipher = createCipheriv("aes-128-ecb", key, null);
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		expect(decryptEcb(encrypted, key)).toEqual(plaintext);
	});

	test("encryptEcb round-trips with decryptEcb", () => {
		const key = Buffer.from("0123456789abcdef");
		const plaintext = Buffer.from("wechat outbound payload");
		expect(decryptEcb(encryptEcb(plaintext, key), key)).toEqual(plaintext);
	});

	test("aesEcbPaddedSize pads to the next block, always adding one block", () => {
		const cases: Array<[number, number]> = [
			[0, 16],
			[1, 16],
			[15, 16],
			[16, 32],
			[17, 32],
			[31, 32],
			[32, 48],
		];
		for (const [plain, padded] of cases) expect(aesEcbPaddedSize(plain)).toBe(padded);
	});

	test("sniffImageMime recognizes png, jpeg, gif, and webp, and defaults to jpeg", () => {
		expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toBe("image/png");
		expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 1]))).toBe("image/jpeg");
		expect(sniffImageMime(Buffer.from("GIF89a"))).toBe("image/gif");
		const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
		expect(sniffImageMime(webp)).toBe("image/webp");
		expect(sniffImageMime(Buffer.from([1, 2, 3]))).toBe("image/jpeg");
	});

	test("sanitizeFileName strips separators, control chars, and leading dots", () => {
		expect(sanitizeFileName("../a/b\u0000c.txt")).toBe("_a_b c.txt");
		expect(sanitizeFileName("   ")).toBe("file");
	});

	test("sanitizeFileName caps an overly long name", () => {
		expect(sanitizeFileName("a".repeat(200)).length).toBe(120);
	});
});

describe("media URLs", () => {
	test("mediaDownloadUrl prefers a full URL and encodes the fallback", () => {
		expect(mediaDownloadUrl({ full_url: "https://cdn/x?y=1", encrypt_query_param: "p" }, "https://base")).toBe(
			"https://cdn/x?y=1",
		);
		expect(mediaDownloadUrl({ encrypt_query_param: "a b&c" }, "https://base/c2c")).toBe(
			"https://base/c2c/download?encrypted_query_param=a%20b%26c",
		);
	});

	test("buildUploadUrl encodes the upload param and filekey", () => {
		expect(buildUploadUrl("https://cdn/c2c", "a b&c", "ff00")).toBe(
			"https://cdn/c2c/upload?encrypted_query_param=a%20b%26c&filekey=ff00",
		);
	});

	test("uploadUrlOf prefers the full URL, builds from the param, and refuses neither", () => {
		expect(uploadUrlOf({ uploadFullUrl: "https://up/x", uploadParam: "p" }, "https://cdn", "k")).toBe("https://up/x");
		expect(uploadUrlOf({ uploadParam: "p" }, "https://cdn/c2c", "k")).toBe(
			"https://cdn/c2c/upload?encrypted_query_param=p&filekey=k",
		);
		expect(() => uploadUrlOf({}, "https://cdn", "k")).toThrow();
	});

	test("saveMedia creates the directory and writes the bytes", () => {
		const dir = join(tempDir("wechat-media-"), "nested");
		const path = saveMedia(dir, "photo.jpg", Buffer.from([1, 2, 3]));
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
	});
});

describe("outbound files", () => {
	function fakeClient() {
		const uploadRequests: Array<Record<string, unknown>> = [];
		const uploads: Array<{ url: string; body: Uint8Array }> = [];
		const sent: Array<Record<string, unknown>> = [];
		let uploadParam: string | undefined = "up";
		let fullUrl: string | undefined;
		let uploadResult = "dl";
		let uploadError: Error | undefined;
		let sendRet: number | undefined = 0;

		const fake = {
			getUploadUrl: async (_account: BotCredentials, req: Record<string, unknown>) => {
				uploadRequests.push(req);
				return { uploadParam, uploadFullUrl: fullUrl };
			},
			uploadCdn: async (url: string, body: Uint8Array) => {
				uploads.push({ url, body });
				if (uploadError) throw uploadError;
				return uploadResult;
			},
			sendFileMessage: async (_account: BotCredentials, args: Record<string, unknown>) => {
				sent.push(args);
				return { ret: sendRet };
			},
		} as unknown as WechatClient;

		return {
			client: fake,
			uploadRequests,
			uploads,
			sent,
			setFullUrl: (value: string | undefined) => {
				fullUrl = value;
			},
			setUploadError: (value: Error) => {
				uploadError = value;
			},
			setSendRet: (value: number | undefined) => {
				sendRet = value;
			},
		};
	}

	function tempFile(content: string): string {
		const path = join(tempDir("wechat-outbound-"), "plan.md");
		writeFileSync(path, content);
		return path;
	}

	const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 0xab);

	function baseArgs(path: string, fake: WechatClient) {
		return {
			client: fake,
			account,
			cdnBaseUrl: "https://cdn/c2c",
			maxBytes: 1024,
			to: "peer",
			contextToken: "ctx",
			filePath: path,
			random: fixedRandom,
		};
	}

	test("uploads the ciphertext and sends a file item", async () => {
		const content = "plan body";
		const path = tempFile(content);
		const h = fakeClient();
		const ok = await sendLocalFile(baseArgs(path, h.client));

		expect(ok).toBe(true);
		const key = fixedRandom(16).toString("hex");
		expect(h.uploadRequests[0]).toMatchObject({
			filekey: key,
			mediaType: UPLOAD_MEDIA_TYPE_FILE,
			toUserId: "peer",
			rawsize: Buffer.byteLength(content),
			rawfilemd5: createHash("md5").update(content).digest("hex"),
			filesize: aesEcbPaddedSize(Buffer.byteLength(content)),
			aeskey: key,
		});

		expect(h.uploads[0]?.url).toBe(
			"https://cdn/c2c/upload?encrypted_query_param=up&filekey=abababababababababababababababab",
		);
		expect(h.uploads[0]?.body).toEqual(encryptEcb(Buffer.from(content), fixedRandom(16)));

		expect(h.sent[0]).toMatchObject({
			to: "peer",
			fileName: "plan.md",
			len: String(Buffer.byteLength(content)),
			contextToken: "ctx",
			media: {
				encrypt_query_param: "dl",
				aes_key: Buffer.from(key).toString("base64"),
				encrypt_type: 1,
			},
		});
	});

	test("prefers a server-provided full upload URL", async () => {
		const path = tempFile("x");
		const h = fakeClient();
		h.setFullUrl("https://up/full");
		await sendLocalFile(baseArgs(path, h.client));
		expect(h.uploads[0]?.url).toBe("https://up/full");
	});

	test("refuses an oversize or empty file without uploading", async () => {
		const h = fakeClient();
		expect(await sendLocalFile({ ...baseArgs(tempFile("too big"), h.client), maxBytes: 2 })).toBe(false);
		expect(await sendLocalFile(baseArgs(tempFile(""), h.client))).toBe(false);
		expect(h.uploadRequests).toHaveLength(0);
	});

	test("returns false for a missing file, a failed upload, or a rejected send", async () => {
		const h = fakeClient();
		expect(await sendLocalFile(baseArgs(join(tempDir("wechat-outbound-"), "nope.md"), h.client))).toBe(false);

		const failUpload = fakeClient();
		failUpload.setUploadError(new Error("cdn down"));
		expect(await sendLocalFile(baseArgs(tempFile("x"), failUpload.client))).toBe(false);

		const badSend = fakeClient();
		badSend.setSendRet(-1);
		expect(await sendLocalFile(baseArgs(tempFile("x"), badSend.client))).toBe(false);
	});

	test("sanitizes the file name", async () => {
		const h = fakeClient();
		await sendLocalFile({ ...baseArgs(tempFile("x"), h.client), fileName: "a/b.md" });
		expect(h.sent[0]?.fileName).toBe("a_b.md");
	});
});

describe("peer history", () => {
	const peer = "alice@im.wechat";

	function message(role: "user" | "assistant", content: unknown, id: string): SessionEntry {
		return {
			type: "message",
			id,
			parentId: null,
			timestamp: "2026-10-18T00:00:00.000Z",
			message: { role, content, timestamp: 1 },
		} as unknown as SessionEntry;
	}

	function assistantText(text: string, id: string): SessionEntry {
		return message("assistant", [{ type: "text", text }], id);
	}

	test("formatHistory prints one line per user/assistant message, oldest first", () => {
		const entries = [message("user", "hello\nworld", "1"), assistantText("hi there", "2")];
		expect(formatHistory(entries, 8)).toBe("You: hello world\nMe: hi there");
	});

	test("formatHistory keeps only the requested tail", () => {
		const entries = [message("user", "one", "1"), assistantText("two", "2"), message("user", "three", "3")];
		expect(formatHistory(entries, 2)).toBe("Me: two\nYou: three");
	});

	test("formatHistory elides a long message", () => {
		const long = "x".repeat(HISTORY_LINE_CHARS + 20);
		const line = formatHistory([message("user", long, "1")], 1);
		expect(line.length).toBe(`You: `.length + HISTORY_LINE_CHARS);
		expect(line.endsWith("…")).toBe(true);
	});

	test("formatHistory ignores non-message entries and empty text", () => {
		expect(formatHistory([{ type: "label", id: "1", parentId: null, timestamp: "", label: "x" } as never], 8)).toBe("");
		expect(formatHistory([message("user", "   ", "1")], 8)).toBe("");
	});

	test("readPeerHistory reads the newest session from the peer's directory without creating one", async () => {
		const root = tempDir("wechat-history-");
		const manager = SessionManager.create(root, peerSessionDir(root, peer));
		manager.appendMessage({ role: "user", content: "hello", timestamp: 1 } as never);
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hi there" }],
			api: "x",
			provider: "x",
			model: "m",
			usage: {},
			stopReason: "stop",
			timestamp: 2,
		} as never);

		expect(await readPeerHistory(root, root, peer, 8)).toBe("You: hello\nMe: hi there");
	});

	test("readPeerHistory returns an empty string when the peer has no session", async () => {
		const root = tempDir("wechat-history-");
		expect(await readPeerHistory(root, root, "nobody@im.wechat", 8)).toBe("");
	});
});
