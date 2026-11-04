/**
 * What a waiting peer is told while their turn is on its way: the typing indicator,
 * one queue acknowledgement per wait, and one "still working" line for a slow turn.
 */

import { describe, expect, test } from "bun:test";
import { makeClock } from "../../../test/helpers/clock.ts";
import { account } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import { settle } from "../../../test/helpers/process.ts";
import type { WechatClient } from "../transport/client.ts";
import type { ArmTimer } from "../timer.ts";
import type { BotCredentials } from "../types.ts";
import type { TurnState } from "./turn.ts";
import { createPresence, type PresenceDeps } from "./presence.ts";

describe("presence", () => {
	function manualTimers() {
		const pending: Array<{ ms: number; fn: () => void }> = [];
		const arm: ArmTimer = (ms, fn) => {
			const entry = { ms, fn };
			pending.push(entry);
			return () => {
				const index = pending.indexOf(entry);
				if (index >= 0) pending.splice(index, 1);
			};
		};
		return {
			arm,
			fire(ms: number) {
				for (const entry of pending.filter((candidate) => candidate.ms === ms)) {
					const index = pending.indexOf(entry);
					if (index >= 0) pending.splice(index, 1);
					entry.fn();
				}
			},
			count: (ms?: number) => (ms === undefined ? pending.length : pending.filter((entry) => entry.ms === ms).length),
		};
	}

	function presenceHarness(overrides: Partial<PresenceDeps> = {}) {
		const timers = manualTimers();
		const clock = makeClock(1000);
		const sent: Array<{ peer: string; text: string }> = [];
		const typing: Array<{ ilinkUserId: string; typing: boolean }> = [];
		let current: TurnState["status"] = "idle";
		let promptWaiting = false;
		let ticket: string | undefined = "ticket";
		const client = {
			getConfig: async () => ({ ret: 0, typingTicket: ticket }),
			sendTyping: async (
				_account: BotCredentials,
				args: { ilinkUserId: string; typingTicket: string; typing: boolean },
			) => {
				typing.push({ ilinkUserId: args.ilinkUserId, typing: args.typing });
				return { ret: 0 };
			},
		} as unknown as WechatClient;
		const presence = createPresence({
			typingIndicator: () => true,
			now: clock.now,
			armTimer: timers.arm,
			client: () => client,
			account: () => account,
			signal: () => undefined,
			statusOf: () => current,
			languageOf: () => "en",
			send: async (contextToken, text) => {
				sent.push({ peer: contextToken ?? "", text });
			},
			promptPending: () => promptWaiting,
			...overrides,
		});
		return {
			presence,
			timers,
			clock,
			sent,
			typing,
			status: (_peer: string, state: TurnState["status"]) => {
				current = state;
			},
			promptWaiting: (waiting: boolean) => {
				promptWaiting = waiting;
			},
			noTicket: () => {
				ticket = undefined;
			},
		};
	}

	test("sets typing on, refreshes it while the peer has work, and stops when idle", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.keepTyping(undefined);
		await settle();
		expect(harness.typing[0]).toEqual({ ilinkUserId: "owner@im.wechat", typing: true });
		expect(harness.timers.count(10_000)).toBe(1);

		harness.timers.fire(10_000);
		await settle();
		expect(harness.typing.filter((call) => call.typing).length).toBe(2);

		harness.status("alice", "idle");
		harness.timers.fire(10_000);
		expect(harness.timers.count(10_000)).toBe(0);
	});

	test("does not send typing without a ticket", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.noTicket();
		harness.presence.keepTyping(undefined);
		await settle();
		expect(harness.typing).toEqual([]);
	});

	test("acknowledges a waiting peer once after the delay", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck(undefined);
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toEqual([{ peer: "", text: "Queued — I'll answer next." }]);

		// A second message inside the repeat window is not acknowledged again.
		harness.presence.armAck(undefined);
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toHaveLength(1);
	});

	test("acknowledges a message queued behind a running turn", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.armAck(undefined);
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent.map((entry) => entry.text)).toEqual(["Queued — I'll answer next."]);
	});

	test("cancels a pending acknowledgement when the turn starts", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck(undefined);
		harness.presence.cancelAck();
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toEqual([]);
	});

	test("says busy once, a minute after the acknowledgement", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck(undefined);
		harness.timers.fire(4000);
		await settle();
		harness.timers.fire(60_000);
		await settle();
		const busy = harness.sent.filter((entry) => entry.text.includes("Still on the previous message"));
		expect(busy).toHaveLength(1);

		harness.timers.fire(60_000);
		await settle();
		expect(harness.sent.filter((entry) => entry.text.includes("Still on the previous message"))).toHaveLength(1);
	});

	test("says still working once for a slow turn", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.armSlowNotice(undefined);
		harness.timers.fire(30_000);
		await settle();
		expect(harness.sent[0]?.text).toContain("/stop");
		// One line per slow turn, not a heartbeat.
		harness.timers.fire(30_000);
		await settle();
		expect(harness.sent).toHaveLength(1);
	});

	test("does not say still working while a dialog waits for an answer", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.promptWaiting(true);
		harness.presence.armSlowNotice(undefined);
		harness.timers.fire(30_000);
		await settle();
		// The prompt nudges for itself; a second bubble would read as noise.
		expect(harness.sent).toEqual([]);
	});

	test("typingOff clears the indicator and reset drops every timer", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.keepTyping(undefined);
		await settle();
		await harness.presence.typingOff();
		expect(harness.typing.at(-1)).toEqual({ ilinkUserId: "owner@im.wechat", typing: false });

		harness.presence.armSlowNotice(undefined);
		harness.presence.reset();
		expect(harness.timers.count()).toBe(0);
	});
});
