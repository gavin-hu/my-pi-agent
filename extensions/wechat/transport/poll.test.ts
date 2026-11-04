/**
 * The poll loop's watchdog and its one hand-over: how long one `getupdates` may
 * hang, and the lost poller lock that ends the loop instead of sharing the account.
 *
 * The third thing it owns is the batch's acknowledgement: the cursor is what makes the
 * server forget a message, so it moves only once the batch has been handed over and the
 * connection is still ours — an interrupted batch is read again, never lost.
 *
 * The server reports how long it held a poll, which is a better bound than the
 * generic fallback — but only for the hold it actually answered. A configured
 * `pollHoldMs` that changes afterwards has to take effect, or a lowered hold
 * leaves the watchdog loose forever and a wedged poll goes unnoticed.
 */

import { describe, expect, test } from "bun:test";
import type { BotCredentials, UpdatesResponse } from "../types.ts";
import type { WechatClient } from "./client.ts";
import { waitFor } from "../../../test/helpers/process.ts";
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
			startHeartbeat: () => () => {},
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
			startHeartbeat: () => () => {},
			isRunning: () => running,
			now: () => 0,
			pollTimeout: () => 1_000,
		};

		await createPollLoop(deps).run(new AbortController().signal);

		// One poll under the held lock, and no request after the lost one.
		expect({ polls, checks }).toEqual({ polls: 1, checks: 2 });
	});

	test("beats under the lock for the whole run, and stops beating with it", async () => {
		// One attempt can outlast the stale bar, so the beat lasts exactly as long as the loop. One
		// left armed would keep a record fresh that this process no longer holds.
		let armed = 0;
		let stopped = 0;
		const client = {
			getUpdates: async (_account: BotCredentials, _cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
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
			refreshLock: () => {},
			startHeartbeat: () => {
				armed += 1;
				return () => {
					stopped += 1;
				};
			},
			isRunning: () => true,
			now: () => 0,
			pollTimeout: () => 1_000,
		};
		const controller = new AbortController();
		const run = createPollLoop(deps).run(controller.signal);

		await waitFor(() => armed === 1);
		expect(stopped).toBe(0);

		controller.abort();
		await run;
		expect({ armed, stopped }).toEqual({ armed: 1, stopped: 1 });
	});
});

describe("the batch acknowledgement", () => {
	/** One answer carrying a message, at a new cursor. */
	function batch(buf: string): UpdatesResponse {
		return { ret: 0, msgs: [{ from_user_id: "owner@im.wechat", item_list: [] }], buf };
	}

	/** A client that answers from a script, then holds the poll open until it is aborted. */
	function scriptedClient(answers: Array<UpdatesResponse | Error>) {
		const queue = [...answers];
		const attempted: string[] = [];
		const client = {
			getUpdates: async (_account: BotCredentials, cursor: string, signal?: AbortSignal): Promise<UpdatesResponse> => {
				attempted.push(cursor);
				const next = queue.shift();
				if (next instanceof Error) throw next;
				if (next) return next;
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted");
			},
		} as unknown as WechatClient;
		return { client, attempted };
	}

	/**
	 * A loop over one client, writing down what it acknowledged and when. `onMessages`
	 * runs inside the recorded hand-off, so a test can hold it and watch the cursor.
	 */
	function harness(
		client: WechatClient,
		options: {
			running?: () => boolean;
			onMessages?: () => void | Promise<void>;
			startHeartbeat?: () => () => void;
		} = {},
	) {
		const events: string[] = [];
		const notices: string[] = [];
		const sleeps: number[] = [];
		const controller = new AbortController();
		let cursor = "c0";
		const deps: PollDeps = {
			client: () => client,
			account: () => ACCOUNT,
			holdMs: () => undefined,
			cursor: () => cursor,
			setCursor: (next) => {
				cursor = next;
				events.push("cursor");
			},
			saveState: () => events.push("save"),
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			notify: (message) => notices.push(message),
			onExpired: () => {},
			onMessages: async () => {
				events.push("handoff");
				await options.onMessages?.();
			},
			refreshLock: () => {},
			startHeartbeat: options.startHeartbeat ?? (() => () => {}),
			isRunning: options.running ?? (() => true),
			now: () => 0,
			pollTimeout: () => 1_000,
		};
		const done = createPollLoop(deps).run(controller.signal);
		return {
			done,
			events,
			notices,
			sleeps,
			cursor: () => cursor,
			abort: () => controller.abort(),
		};
	}

	test("waits for the hand-off before it moves the cursor", async () => {
		// The cursor is the server's permission to forget the batch, so a message still
		// downloading is not read yet: it becomes durable after the hand-off returns.
		const { client, attempted } = scriptedClient([batch("c2")]);
		let release: (() => void) | undefined;
		const handoff = new Promise<void>((resolve) => {
			release = resolve;
		});
		const loop = harness(client, { onMessages: () => handoff });

		await waitFor(() => loop.events.includes("handoff"));
		expect({ events: loop.events, cursor: loop.cursor() }).toEqual({ events: ["handoff"], cursor: "c0" });

		release?.();
		await waitFor(() => loop.events.includes("save"));
		expect(loop.events.slice(0, 3)).toEqual(["handoff", "cursor", "save"]);
		expect(loop.cursor()).toBe("c2");

		loop.abort();
		await loop.done;
		expect(attempted).toEqual(["c0", "c2"]);
	});

	test("keeps the old cursor when a close interrupted the batch", async () => {
		// The bridge closed while the batch was being handled. Nothing about it may be
		// written down, or the next connection has no way to read the message again.
		const { client, attempted } = scriptedClient([batch("c2")]);
		let running = true;
		const loop = harness(client, {
			running: () => running,
			onMessages: () => {
				running = false;
			},
		});

		await loop.done;

		expect(loop.events).toEqual(["handoff"]);
		expect(attempted).toEqual(["c0"]);
	});

	test("does not hand a batch over once the connection is no longer ours", async () => {
		// A heartbeat can find a takeover while the request is parked. The batch then belongs to
		// the new holder, so handing it over here would answer the peer a second time.
		let running = true;
		const client = {
			getUpdates: async (): Promise<UpdatesResponse> => {
				running = false;
				return batch("c2");
			},
		} as unknown as WechatClient;
		const loop = harness(client, { running: () => running });

		await loop.done;

		// No hand-off, and nothing written: no cursor, no save.
		expect(loop.events).toEqual([]);
	});

	test("reports a transport error once per episode", async () => {
		// Two seconds apart during an outage: a line per attempt would bury the terminal,
		// so one line per episode, as the timeout and rejection branches beside it do.
		const { client, attempted } = scriptedClient([
			new Error("socket hang up"),
			new Error("socket hang up"),
			batch("c1"),
		]);
		const loop = harness(client);

		await waitFor(() => attempted.length > 2);
		expect(loop.notices.filter((message) => message.includes("poll failed"))).toHaveLength(1);
		expect(loop.sleeps).toEqual([2_000, 2_000]);

		loop.abort();
		await loop.done;
	});
});
