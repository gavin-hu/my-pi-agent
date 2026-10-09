import { describe, expect, test } from "bun:test";
import type { WechatClient } from "./client.ts";
import { classifyStatus, credentialsFromStatus, type LoginOptions, type StatusKind, waitForLogin } from "./login.ts";
import type { QrResponse, QrStatus } from "./types.ts";

const qr: QrResponse = { qrcode: "Q", imgContent: "url" };

function fakeClient(statuses: QrStatus[]): { client: WechatClient; seen: Array<{ verify?: string }> } {
	let index = 0;
	const seen: Array<{ verify?: string }> = [];
	const client = {
		pollQrStatus: async (_qrcode: string, verify?: string) => {
			seen.push({ verify });
			const value = statuses[Math.min(index, statuses.length - 1)];
			index += 1;
			return value;
		},
	} as unknown as WechatClient;
	return { client, seen };
}

function options(overrides: Partial<LoginOptions> = {}): LoginOptions {
	return { botAgent: "ag", now: () => 1000, sleep: async () => {}, ...overrides };
}

describe("classifyStatus", () => {
	test("maps each documented status", () => {
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
});

describe("credentialsFromStatus", () => {
	test("builds an account from a complete status", () => {
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
	});

	test("returns undefined for an incomplete status", () => {
		expect(credentialsFromStatus({ status: "confirmed", botToken: "t" }, "ag", 1000)).toBeUndefined();
	});
});

describe("waitForLogin", () => {
	test("returns the account when the login is confirmed", async () => {
		const { client } = fakeClient([
			{ status: "confirmed", botToken: "t", ilinkUserId: "u", ilinkBotId: "b", baseUrl: "https://x" },
		]);
		const outcome = await waitForLogin(client, qr, options());
		expect(outcome).toEqual({
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
		const { client, seen } = fakeClient([
			{ status: "need_verifycode" },
			{ status: "confirmed", botToken: "t", ilinkUserId: "u" },
		]);
		const outcome = await waitForLogin(client, qr, options({ requestVerifyCode: async () => "1234" }));
		expect(outcome.kind).toBe("confirmed");
		expect(seen[1]?.verify).toBe("1234");
	});

	test("cancels when no verification code is provided", async () => {
		const { client } = fakeClient([{ status: "need_verifycode" }]);
		expect(await waitForLogin(client, qr, options({ requestVerifyCode: async () => undefined }))).toEqual({
			kind: "cancelled",
		});
	});

	test("reports an expired QR", async () => {
		const { client } = fakeClient([{ status: "expired" }]);
		expect(await waitForLogin(client, qr, options())).toEqual({ kind: "expired" });
	});

	test("cancels immediately when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { client } = fakeClient([{ status: "wait" }]);
		expect(await waitForLogin(client, qr, options({ signal: controller.signal }))).toEqual({ kind: "cancelled" });
	});
});
