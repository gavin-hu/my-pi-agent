/**
 * The pending-report channel: the state machine that decides when an outcome may
 * raise a turn, and the host hooks that drive it.
 *
 * The reporter tests drive the machine directly; the channel tests drive the
 * seven registered hooks through a fake `pi`, with a recording runtime so the
 * order a session start and a shutdown take is asserted rather than assumed.
 */

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { noticeMessage, type NoticeMessage } from "./notice.ts";
import {
	createPendingReporter,
	registerPendingChannel,
	type PendingChannelRuntime,
	type PendingReporter,
} from "./report.ts";
import { createFakePi, emit, emitFirst } from "../test/helpers/fakes.ts";

describe("createPendingReporter", () => {
	interface Outcome {
		id: string;
	}

	/** A reporter over a queue that records every wake, mark, and `onWoke` batch. */
	function harness(options: { fail?: boolean } = {}) {
		const queued: Outcome[] = [];
		const marked = new Set<string>();
		const woken: NoticeMessage[] = [];
		const wokeBatches: Outcome[][] = [];
		const markedBatches: string[][] = [];
		const reporter = createPendingReporter<Outcome>({
			wake: (notice) => {
				if (options.fail) throw new Error("send failed");
				woken.push(notice);
			},
			pending: () => queued.filter((item) => !marked.has(item.id)),
			markReported: (items) => {
				markedBatches.push(items.map((item) => item.id));
				for (const item of items) marked.add(item.id);
			},
			buildNotice: (items) =>
				noticeMessage({
					content: `${items.length} finished`,
					details: { source: "test", title: `${items.length} finished` },
				}),
			source: "test",
			onWoke: (items) => wokeBatches.push([...items]),
		});
		return {
			reporter,
			queue: (...ids: string[]) => {
				for (const id of ids) queued.push({ id });
			},
			woken,
			wokeBatches,
			markedBatches,
			pending: () => queued.filter((item) => !marked.has(item.id)).map((item) => item.id),
		};
	}

	/** A notice entry for one source, as the session would hand it back. */
	function noticeEntry(source: string): AgentMessage {
		return {
			role: "custom",
			...noticeMessage({ content: source, details: { source, title: source } }),
		} as unknown as AgentMessage;
	}

	test("wakes one turn and reports every queued outcome", () => {
		const h = harness();
		h.queue("a", "b");
		h.reporter.report();
		expect(h.woken).toHaveLength(1);
		expect(h.woken[0]?.content).toBe("2 finished");
		expect(h.wokeBatches).toEqual([[{ id: "a" }, { id: "b" }]]);
		expect(h.markedBatches).toEqual([["a", "b"]]);
	});

	test("does not wake a second turn before the first turn starts", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		// A second outcome arrives in the window before `agent_start`.
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(1);
		expect(h.pending()).toEqual(["b"]);
	});

	test("wakes again after the run settles", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		h.reporter.agentStart();
		h.reporter.agentSettled();
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(2);
	});

	test("queues without waking while the agent is mid-turn", () => {
		const h = harness();
		h.reporter.agentStart();
		h.queue("a");
		h.reporter.report();
		expect(h.woken).toEqual([]);
		expect(h.pending()).toEqual(["a"]);
	});

	test("reports leftovers at the next turn without triggering one", () => {
		const h = harness();
		h.reporter.agentStart();
		h.queue("a", "b");
		h.reporter.report();
		const result = h.reporter.beforeAgentStart();
		expect(result?.message.content).toBe("2 finished");
		expect(h.woken).toEqual([]);
		expect(h.pending()).toEqual([]);
	});

	test("reports nothing when no outcome is queued", () => {
		const h = harness();
		expect(h.reporter.beforeAgentStart()).toBeUndefined();
		h.reporter.report();
		expect(h.woken).toEqual([]);
	});

	test("leaves the burst unmarked when the send throws, so the next turn reports it", () => {
		const h = harness({ fail: true });
		h.queue("a");
		h.reporter.report();
		expect(h.wokeBatches).toEqual([]);
		expect(h.markedBatches).toEqual([]);
		expect(h.reporter.beforeAgentStart()?.message.content).toBe("1 finished");
	});

	test("clears both flags for a new session", () => {
		const h = harness();
		h.queue("a");
		h.reporter.report();
		h.reporter.sessionStart();
		h.queue("b");
		h.reporter.report();
		expect(h.woken).toHaveLength(2);
	});

	test("prunes only its own stale notices", () => {
		const h = harness();
		const plain = { role: "user", content: "hi" } as unknown as AgentMessage;
		const other = noticeEntry("other");
		const stale = noticeEntry("test");
		const newest = noticeEntry("test");
		const result = h.reporter.filterContext([other, stale, plain, newest]);
		expect(result?.messages).toEqual([other, plain, newest]);
	});

	test("leaves the context alone when nothing is stale", () => {
		const h = harness();
		expect(h.reporter.filterContext([noticeEntry("test")])).toBeUndefined();
	});
});

// --- The host wiring ---------------------------------------------------------

describe("registerPendingChannel", () => {
	/** A reporter that records what the hooks call, and reports a notice on demand. */
	function fakeReporter(log: string[]) {
		const notice = noticeMessage({ content: "1 finished", details: { source: "test", title: "1 finished" } });
		let queued = false;
		const reporter: PendingReporter = {
			report: () => log.push("report"),
			sessionStart: () => log.push("sessionStart"),
			agentStart: () => log.push("agentStart"),
			agentSettled: () => log.push("agentSettled"),
			beforeAgentStart: () => {
				log.push("beforeAgentStart");
				return queued ? { message: notice } : undefined;
			},
			filterContext: (messages) => {
				log.push(`filter:${messages.length}`);
				return undefined;
			},
		};
		return {
			reporter,
			notice,
			queue: () => {
				queued = true;
			},
		};
	}

	/** The runtime seam, recording each call in the order the hooks make it. */
	function fakeRuntime(log: string[]): PendingChannelRuntime {
		return {
			load: () => log.push("load"),
			setStatus: () => log.push("status"),
			shutdown: async () => {
				log.push("shutdown");
			},
		};
	}

	const ctx = {} as ExtensionContext;

	test("registers one handler for each lifecycle hook", () => {
		const { pi, handlers } = createFakePi();
		registerPendingChannel(pi, { reporter: fakeReporter([]).reporter, runtime: fakeRuntime([]) });
		expect([...handlers.keys()].sort()).toEqual([
			"agent_settled",
			"agent_start",
			"before_agent_start",
			"context",
			"session_shutdown",
			"session_start",
			"session_tree",
		]);
	});

	test("a session start resets the reporter, loads the records, then arms", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, {
			reporter: fakeReporter(log).reporter,
			runtime: fakeRuntime(log),
			onSessionStart: () => log.push("arm"),
		});
		await emit(pi, "session_start", {}, ctx);
		expect(log).toEqual(["sessionStart", "load", "arm"]);
	});

	test("tree navigation only repaints", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, { reporter: fakeReporter(log).reporter, runtime: fakeRuntime(log) });
		await emit(pi, "session_tree", {}, ctx);
		expect(log).toEqual(["status"]);
	});

	test("a run's start and settle reach the reporter", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, { reporter: fakeReporter(log).reporter, runtime: fakeRuntime(log) });
		await emit(pi, "agent_start", {}, ctx);
		await emit(pi, "agent_settled", {}, ctx);
		expect(log).toEqual(["agentStart", "agentSettled"]);
	});

	test("the next turn returns the notice and repaints only when there is one", async () => {
		const log: string[] = [];
		const fake = fakeReporter(log);
		const { pi } = createFakePi();
		registerPendingChannel(pi, { reporter: fake.reporter, runtime: fakeRuntime(log) });
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toBeUndefined();
		fake.queue();
		expect(await emitFirst(pi, "before_agent_start", {}, ctx)).toEqual({ message: fake.notice });
		expect(log).toEqual(["beforeAgentStart", "beforeAgentStart", "status"]);
	});

	test("the context hook hands its messages to the reporter", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, { reporter: fakeReporter(log).reporter, runtime: fakeRuntime(log) });
		await emit(pi, "context", { messages: [{}, {}] }, ctx);
		expect(log).toEqual(["filter:2"]);
	});

	test("a shutdown disarms before the runtime releases", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, {
			reporter: fakeReporter(log).reporter,
			runtime: fakeRuntime(log),
			onSessionShutdown: () => log.push("disarm"),
		});
		await emit(pi, "session_shutdown", {}, ctx);
		expect(log).toEqual(["disarm", "shutdown"]);
	});

	test("both lifecycle hooks are optional", async () => {
		const log: string[] = [];
		const { pi } = createFakePi();
		registerPendingChannel(pi, { reporter: fakeReporter(log).reporter, runtime: fakeRuntime(log) });
		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		expect(log).toEqual(["sessionStart", "load", "shutdown"]);
	});
});
