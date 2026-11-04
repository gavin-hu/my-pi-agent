/**
 * The poll loop's own behaviour: what it does with a batch of messages, a wedged or
 * rejected poll, an expired token, and a connection that is no longer running.
 *
 * The cursor is the whole contract here — a retry keeps it, a rejection leaves it
 * alone, and only a delivered batch advances it.
 */

import { describe, expect, test } from "bun:test";
import { updates } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import { waitFor } from "../../../test/helpers/process.ts";
import type { BotCredentials, UpdatesResponse, WeixinMessage } from "../types.ts";
import type { WechatClient } from "./client.ts";
import { createPollLoop, defaultPollTimeout } from "./poll.ts";

const ACCOUNT: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

describe("poll loop", () => {
	function pollHarness(responses: UpdatesResponse[], options: { wedge?: number; running?: boolean } = {}) {
		const remaining = [...responses];
		const messages: WeixinMessage[] = [];
		const notices: string[] = [];
		const polls: Array<{ at: number; error?: string; holdMs?: number }> = [];
		const sleeps: number[] = [];
		const cursors: string[] = [];
		let cursor = "c0";
		let saves = 0;
		let refreshes = 0;
		let expired = false;
		let running = options.running ?? true;
		let wedges = options.wedge ?? 0;
		let calls = 0;
		const client = {
			getUpdates: async (_account: BotCredentials, current: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				calls += 1;
				cursors.push(current);
				if (wedges > 0) {
					wedges -= 1;
				} else {
					const next = remaining.shift();
					if (next) return next;
				}
				await new Promise<void>((resolve) => {
					if (!signal || signal.aborted) return resolve();
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const controller = new AbortController();
		const loop = createPollLoop({
			client: () => client,
			account: () => ACCOUNT,
			holdMs: () => undefined,
			cursor: () => cursor,
			setCursor: (next) => {
				cursor = next;
			},
			saveState: () => {
				saves += 1;
			},
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			notify: (message) => notices.push(message),
			onExpired: () => {
				expired = true;
				running = false;
			},
			onMessages: (list) => void messages.push(...list),
			refreshLock: () => {
				refreshes += 1;
			},
			startHeartbeat: () => () => {},
			isRunning: () => running,
			now: () => 1000,
			onPoll: (result) => polls.push(result),
			pollTimeout: () => 5,
		});
		const done = loop.run(controller.signal);
		return {
			done,
			abort: () => controller.abort(),
			messages,
			notices,
			polls,
			sleeps,
			cursors,
			expired: () => expired,
			running: () => running,
			cursor: () => cursor,
			saves: () => saves,
			refreshes: () => refreshes,
			calls: () => calls,
		};
	}

	test("sizes the watchdog from the server hint with a floor and a margin", () => {
		expect(defaultPollTimeout(undefined)).toBe(105_000);
		expect(defaultPollTimeout(5000)).toBe(45_000);
		expect(defaultPollTimeout(60_000)).toBe(75_000);
	});

	test("delivers messages, advances the cursor, and records the poll", async () => {
		const first = updates([{ from_user_id: "alice", item_list: [] }], "c2");
		first.timeoutMs = 5400;
		const sent = pollHarness([first]);
		await waitFor(() => sent.messages.length === 1);
		expect(sent.cursor()).toBe("c2");
		expect(sent.saves()).toBe(1);
		expect(sent.refreshes()).toBeGreaterThanOrEqual(1);
		expect(sent.polls.at(-1)).toEqual({ at: 1000, holdMs: 5400 });
		sent.abort();
		await sent.done;
	});

	test("retries a wedged poll at once, reports it once, and keeps the cursor", async () => {
		const sent = pollHarness([updates([{ from_user_id: "alice", item_list: [] }], "c9")], { wedge: 2 });
		await waitFor(() => sent.messages.length === 1);
		// Two timeouts are one episode: a wedged poll is reported once and retried.
		expect(sent.notices.filter((message) => message.includes("timed out"))).toHaveLength(1);
		// The retries used the same cursor, so nothing was skipped.
		expect(sent.cursors.slice(0, 3)).toEqual(["c0", "c0", "c0"]);
		expect(sent.polls[0]?.error).toContain("timed out");
		sent.abort();
		await sent.done;
	});

	test("backs off when the poll is rejected and keeps the cursor", async () => {
		const sent = pollHarness([
			{ ret: -1, msgs: [], buf: "" },
			{ ret: -1, msgs: [], buf: "" },
			updates([{ from_user_id: "alice", item_list: [] }], "c2"),
		]);
		await waitFor(() => sent.messages.length === 1);
		expect(sent.sleeps).toContain(2000);
		expect(sent.notices.filter((message) => message.includes("rejected"))).toHaveLength(1);
		// Rejections leave the cursor alone; only the successful poll advances it.
		expect(sent.cursor()).toBe("c2");
		expect(sent.cursors.slice(0, 3)).toEqual(["c0", "c0", "c0"]);
		sent.abort();
		await sent.done;
	});

	test("reports a transport error, backs off, and retries", async () => {
		const notices: string[] = [];
		const sleeps: number[] = [];
		const messages: WeixinMessage[] = [];
		const controller = new AbortController();
		let calls = 0;
		const client = {
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				calls += 1;
				if (calls === 1) throw new Error("socket hang up");
				if (calls === 2) return updates([{ from_user_id: "alice", item_list: [] }], "c2");
				await new Promise<void>((resolve) => {
					if (!signal || signal.aborted) return resolve();
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		const loop = createPollLoop({
			client: () => client,
			account: () => ACCOUNT,
			holdMs: () => undefined,
			cursor: () => "c0",
			setCursor: () => {},
			saveState: () => {},
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			notify: (message) => notices.push(message),
			onExpired: () => {},
			onMessages: (list) => void messages.push(...list),
			refreshLock: () => {},
			startHeartbeat: () => () => {},
			isRunning: () => true,
			now: () => 1000,
			pollTimeout: () => 5,
		});
		const done = loop.run(controller.signal);
		await waitFor(() => messages.length === 1);
		expect(sleeps).toContain(2000);
		expect(notices.some((message) => message.includes("poll failed"))).toBe(true);
		controller.abort();
		await done;
	});

	test("stops when the token expires", async () => {
		const sent = pollHarness([{ ret: 0, errcode: -14, msgs: [], buf: "" }]);
		await sent.done;
		expect(sent.expired()).toBe(true);
		expect(sent.calls()).toBe(1);
	});

	test("does not poll when the connection is already stopped", async () => {
		const sent = pollHarness([], { running: false });
		await sent.done;
		expect(sent.calls()).toBe(0);
	});
});
