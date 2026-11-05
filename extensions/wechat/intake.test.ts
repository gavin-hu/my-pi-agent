/**
 * The inbound path's own decisions: the flood cap and the one line it sends.
 *
 * `bridge.test.ts` proves the cap holds for a burst of media through the whole
 * connection; here the question is the episode behind the line, which the bridge
 * cannot reach — a queue that empties without a turn settling is a state no bridge
 * case can build and no reconnect arrives to reset. The real `createIntake` runs
 * against a queue the test owns, so a slot can be freed the way a failed download
 * frees one, and the next flood's line is the thing under test.
 */

import { describe, expect, test } from "bun:test";
import { createTurnBudget, type AdmissionQueue } from "./conversation/admission.ts";
import { createPresence } from "./conversation/presence.ts";
import type { TurnRunner, TurnState } from "./conversation/turn.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { createIntake, createLanguageOf, MAX_QUEUE } from "./intake.ts";
import { notice } from "./text/notices.ts";
import type { WechatState } from "./types.ts";
import { inbound, owner } from "../../test/helpers/fixtures/wechat-bridge.ts";
import { settle } from "../../test/helpers/process.ts";

/** The line a peer gets when the queue is full, as the notice words it. */
const OVERFLOW = notice("overflow", "en");

/** The conversation's queue, as intake reads it: turns waiting plus slots reserved. */
interface Queue {
	queued: number;
	pending: number;
}

function fakeWorker(queue: Queue): TurnRunner {
	const state = (): TurnState => ({ status: queue.queued > 0 ? "queued" : "idle", queued: queue.queued });
	return {
		enqueue: () => {},
		abort: () => false,
		drain: () => 0,
		running: () => undefined,
		flush: async () => {},
		state,
		close: async () => {},
	};
}

/** Admitting a message reserves its slot; the test decides when the slot is freed. */
function fakeAdmission(queue: Queue): AdmissionQueue {
	return {
		enqueue: () => {
			queue.pending += 1;
		},
		pending: () => queue.pending,
		settled: async () => {},
		reset: () => {
			queue.pending = 0;
		},
	};
}

function harness() {
	const queue: Queue = { queued: 0, pending: 0 };
	const sent: string[] = [];
	const state: WechatState = { cursor: "", ownerId: owner };
	const worker = fakeWorker(queue);
	const workerState = (): TurnState => worker.state();
	const intake = createIntake({
		state: () => state,
		saveState: () => {},
		account: () => undefined,
		config: DEFAULT_CONFIG,
		now: () => 1000,
		notify: () => {},
		worker: () => worker,
		stopTurn: () => ({ stopped: false, dropped: 0 }),
		channel: () => undefined,
		presence: createPresence({
			typingIndicator: () => false,
			now: () => 1000,
			armTimer: () => () => {},
			client: () => undefined,
			account: () => undefined,
			signal: () => undefined,
			statusOf: () => workerState().status,
			languageOf: () => "en",
			send: async () => true,
			promptPending: () => false,
		}),
		budget: createTurnBudget(0, () => 1000),
		admission: fakeAdmission(queue),
		languageOf: createLanguageOf(new Map()),
		reply: async (_target, text) => {
			sent.push(text);
			return true;
		},
		readHistory: async () => "",
		planMode: () => false,
		refused: { value: 0 },
		refusedPeers: new Set(),
		overflow: new Set(),
		slashCommands: [],
	});
	return { queue, sent, intake };
}

describe("the flood cap", () => {
	test("fills the queue to the cap and refuses the rest", async () => {
		const { queue, sent, intake } = harness();
		for (let i = 0; i < MAX_QUEUE + 3; i++) intake.handleMessage(inbound(`flood ${i}`));
		await settle();
		expect(queue.pending).toBe(MAX_QUEUE);
		expect(sent).toEqual([OVERFLOW]);
	});

	test("says the queue is full once per flood, not once per dropped message", async () => {
		const { sent, intake } = harness();
		// Eight fill the queue; the twelve behind them are one flood, one line.
		for (let i = 0; i < MAX_QUEUE + 12; i++) intake.handleMessage(inbound(`flood ${i}`));
		await settle();
		expect(sent).toEqual([OVERFLOW]);
	});

	test("says it again on a later flood, once the queue has had room", async () => {
		const { queue, sent, intake } = harness();
		for (let i = 0; i < MAX_QUEUE + 1; i++) intake.handleMessage(inbound(`first ${i}`));
		await settle();
		expect(sent).toEqual([OVERFLOW]);

		// The queue empties with no turn settling to report it: a burst of media whose
		// downloads all failed frees every reserved slot, and a `/stop` drops what was
		// queued. Either way the connection never reopens.
		queue.pending = 0;
		queue.queued = 0;

		for (let i = 0; i < MAX_QUEUE + 1; i++) intake.handleMessage(inbound(`second ${i}`));
		await settle();
		expect(sent).toEqual([OVERFLOW, OVERFLOW]);
	});
});
