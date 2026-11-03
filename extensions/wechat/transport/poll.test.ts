/**
 * The poll loop's watchdog and its one hand-over: how long one `getupdates` may
 * hang, and the lost poller lock that ends the loop instead of sharing the account.
 *
 * The server reports how long it held a poll, which is a better bound than the
 * generic fallback — but only for the hold it actually answered. A configured
 * `pollHoldMs` that changes afterwards has to take effect, or a lowered hold
 * leaves the watchdog loose forever and a wedged poll goes unnoticed.
 */

import { describe, expect, test } from "bun:test";
import type { BotCredentials, UpdatesResponse } from "../types.ts";
import type { WechatClient } from "./client.ts";
import { createPollLoop, type PollDeps } from "./poll.ts";

const ACCOUNT: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "a",
	createdAt: 0,
};

/** One empty answer that reports how long the server held it. */
function held(timeoutMs: number): UpdatesResponse {
	return { ret: 0, msgs: [], buf: "", timeoutMs };
}

describe("the poll watchdog", () => {
	test("uses the server's hold only while the configured hold is unchanged", async () => {
		// The operator lowers the hold after the second poll; the third must not trust
		// the hint the old hold earned.
		const holds = [100_000, 100_000, 30_000];
		const responses = [held(120_000), held(120_000), held(40_000)];
		const timeouts: Array<number | undefined> = [];
		let polls = 0;
		const client = {
			getUpdates: async (): Promise<UpdatesResponse> => {
				const next = responses[polls] ?? { ret: 0, msgs: [], buf: "" };
				polls += 1;
				return next;
			},
		} as unknown as WechatClient;
		const deps: PollDeps = {
			client: () => client,
			account: () => ACCOUNT,
			holdMs: () => holds[Math.min(polls, holds.length - 1)],
			cursor: () => "",
			setCursor: () => {},
			saveState: () => {},
			sleep: async () => {},
			notify: () => {},
			onExpired: () => {},
			onMessages: () => {},
			refreshLock: () => true,
			isRunning: () => polls < responses.length,
			now: () => 0,
			pollTimeout: (serverHintMs) => {
				timeouts.push(serverHintMs);
				return 1_000;
			},
		};

		await createPollLoop(deps).run(new AbortController().signal);

		// No hint yet; the hint the 100 s hold earned; then the lowered 30 s hold.
		expect(timeouts).toEqual([100_000, 120_000, 30_000]);
	});
});

describe("the poller lock", () => {
	test("stops polling once the lock belongs to another session", async () => {
		// The account is not ours to poll any more: reading it on would take a second
		// cursor and answer the other session's peers again. The bridge stops the
		// connection when the stamp finds the lock gone, and the loop asks the state.
		let polls = 0;
		let checks = 0;
		let running = true;
		const client = {
			getUpdates: async (): Promise<UpdatesResponse> => {
				polls += 1;
				return held(20_000);
			},
		} as unknown as WechatClient;
		const deps: PollDeps = {
			client: () => client,
			account: () => ACCOUNT,
			holdMs: () => undefined,
			cursor: () => "",
			setCursor: () => {},
			saveState: () => {},
			sleep: async () => {},
			notify: () => {},
			onExpired: () => {},
			onMessages: () => {},
			refreshLock: () => {
				checks += 1;
				// The second attempt finds the lock taken, and the bridge's stop is what the
				// loop reads as an end rather than a reason to poll again.
				if (checks === 2) running = false;
			},
			isRunning: () => running,
			now: () => 0,
			pollTimeout: () => 1_000,
		};

		await createPollLoop(deps).run(new AbortController().signal);

		// One poll under the held lock, and no request after the lost one.
		expect({ polls, checks }).toEqual({ polls: 1, checks: 2 });
	});
});
