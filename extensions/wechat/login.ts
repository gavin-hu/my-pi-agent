/**
 * The QR login state machine.
 *
 * `waitForLogin` polls `get_qrcode_status` until a terminal state and returns a
 * `LoginOutcome`. The clock and sleep are injected so the flow is testable
 * without a real timer, and the caller owns displaying the QR.
 */

import { DEFAULT_BASE_URL, type WechatClient } from "./client.ts";
import type { BotCredentials, QrResponse, QrStatus } from "./types.ts";

/** Categorical meaning of a `get_qrcode_status` value. */
export type StatusKind = "pending" | "confirmed" | "expired" | "verify" | "blocked" | "binded";

/** Map a raw status string to its category. Unknown values are `pending`. */
export function classifyStatus(status: string): StatusKind {
	switch (status) {
		case "confirmed":
			return "confirmed";
		case "expired":
			return "expired";
		case "need_verifycode":
			return "verify";
		case "verify_code_blocked":
			return "blocked";
		case "binded_redirect":
			return "binded";
		default:
			return "pending";
	}
}

/** Build stored credentials from a confirmed status, or `undefined` if incomplete. */
export function credentialsFromStatus(status: QrStatus, botAgent: string, now: number): BotCredentials | undefined {
	if (!status.botToken || !status.ilinkUserId) return undefined;
	return {
		botToken: status.botToken,
		ilinkUserId: status.ilinkUserId,
		ilinkBotId: status.ilinkBotId ?? "",
		baseUrl: status.baseUrl ?? DEFAULT_BASE_URL,
		botAgent,
		createdAt: now,
	};
}

export type LoginOutcome =
	| { kind: "confirmed"; account: BotCredentials }
	| { kind: "expired" }
	| { kind: "cancelled" }
	| { kind: "error"; message: string };

export interface LoginOptions {
	botAgent: string;
	now: () => number;
	/** Injected sleep; resolves early/throws when `signal` aborts. */
	sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
	intervalMs?: number;
	signal?: AbortSignal;
	/** Called on every polled status for display. */
	onStatus?: (status: string) => void;
	/** Prompt for a verification code when the server asks for one. */
	requestVerifyCode?: () => Promise<string | undefined>;
}

/** Default sleep, aborted by `signal`. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Poll a started login until it settles. */
export async function waitForLogin(client: WechatClient, qr: QrResponse, options: LoginOptions): Promise<LoginOutcome> {
	const interval = options.intervalMs ?? 2000;
	let verifyCode: string | undefined;
	while (!options.signal?.aborted) {
		let status: QrStatus;
		try {
			status = await client.pollQrStatus(qr.qrcode, verifyCode, options.signal);
		} catch (error) {
			if (options.signal?.aborted) return { kind: "cancelled" };
			return { kind: "error", message: error instanceof Error ? error.message : String(error) };
		}
		options.onStatus?.(status.status);

		switch (classifyStatus(status.status)) {
			case "confirmed": {
				const account = credentialsFromStatus(status, options.botAgent, options.now());
				return account
					? { kind: "confirmed", account }
					: { kind: "error", message: "Login was confirmed but the credentials were incomplete." };
			}
			case "expired":
				return { kind: "expired" };
			case "blocked":
				return { kind: "error", message: "Too many verification attempts; the QR code was blocked." };
			case "binded":
				return { kind: "error", message: "This account is already bound to another Pi instance." };
			case "verify": {
				if (!options.requestVerifyCode) {
					return { kind: "error", message: "The server requested a verification code." };
				}
				const code = await options.requestVerifyCode();
				if (!code) return { kind: "cancelled" };
				verifyCode = code;
				break;
			}
			default:
				await options.sleep(interval, options.signal);
		}
	}
	return { kind: "cancelled" };
}
