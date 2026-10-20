/**
 * The pending-report coordinator: one triggered turn per wake window, leftovers
 * reported at the next turn, and pruning scoped to the reporter's own source.
 */

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { noticeMessage, type NoticeMessage } from "./notice.ts";
import { createPendingReporter } from "./report.ts";

interface Outcome {
	id: string;
}

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

describe("createPendingReporter", () => {
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
		const entry = (source: string): AgentMessage =>
			({
				role: "custom",
				...noticeMessage({ content: source, details: { source, title: source } }),
			}) as unknown as AgentMessage;
		const plain = { role: "user", content: "hi" } as unknown as AgentMessage;
		const other = entry("other");
		const stale = entry("test");
		const newest = entry("test");
		const result = h.reporter.filterContext([other, stale, plain, newest]);
		expect(result?.messages).toEqual([other, plain, newest]);
	});

	test("leaves the context alone when nothing is stale", () => {
		const h = harness();
		const entry = {
			role: "custom",
			...noticeMessage({ content: "x", details: { source: "test", title: "x" } }),
		} as unknown as AgentMessage;
		expect(h.reporter.filterContext([entry])).toBeUndefined();
	});
});
