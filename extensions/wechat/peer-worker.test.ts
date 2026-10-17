import { describe, expect, test } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { settle } from "../../test/helpers/process.ts";
import { createPeerWorker, type PeerItem } from "./peer-worker.ts";
import type { PeerSession } from "./peer-session.ts";

function item(text: string, peer = "alice@im.wechat"): PeerItem {
	return { peer, text, language: "en" };
}

/** A session double: `prompt` resolves with the scripted answer, or waits. */
function fakeSession(options: { answers?: string[]; holdFirst?: boolean } = {}) {
	const prompts: unknown[] = [];
	let abort = 0;
	let disposed = 0;
	const waiters: Array<() => void> = [];
	let last = "";
	const session = {
		isIdle: true,
		getLastAssistantText: () => last,
		async prompt(content: unknown): Promise<void> {
			prompts.push(content);
			if (options.holdFirst && prompts.length === 1) {
				await new Promise<void>((resolve) => waiters.push(resolve));
			}
			last = options.answers?.shift() ?? "";
		},
		async abort(): Promise<void> {
			abort += 1;
			for (const resolve of waiters.splice(0)) resolve();
		},
		dispose(): void {
			disposed += 1;
		},
	};
	return {
		peerSession: { session: session as unknown as AgentSession, dispose: () => session.dispose() } as PeerSession,
		session,
		prompts,
		aborts: () => abort,
		disposed: () => disposed,
	};
}

function harness(options: { answers?: string[]; holdFirst?: boolean; idleTimeoutMs?: number } = {}) {
	const sent: Array<{ peer: string; text: string }> = [];
	const notices: string[] = [];
	const opened: string[] = [];
	const sessions: ReturnType<typeof fakeSession>[] = [];
	const timers: Array<{ ms: number; fn: () => void }> = [];
	const worker = createPeerWorker({
		openSession: async (peer) => {
			opened.push(peer);
			const fake = fakeSession(options);
			sessions.push(fake);
			return fake.peerSession;
		},
		send: async (target, text) => {
			sent.push({ peer: target.peer, text });
		},
		fallback: (_target, reason) => `fallback:${reason}`,
		notify: (message) => notices.push(message),
		idleTimeoutMs: options.idleTimeoutMs ?? 0,
		armTimer: (_ms, fn) => {
			timers.push({ ms: _ms, fn });
			return () => {
				const index = timers.findIndex((entry) => entry.fn === fn);
				if (index >= 0) timers.splice(index, 1);
			};
		},
	});
	return { worker, sent, notices, opened, sessions, timers };
}

describe("peer worker", () => {
	test("opens one session per peer and answers there", async () => {
		const { worker, sent, opened } = harness({ answers: ["pong"] });
		worker.enqueue(item("ping"));
		await settle();
		expect(opened).toEqual(["alice@im.wechat"]);
		expect(sent).toEqual([{ peer: "alice@im.wechat", text: "pong" }]);
	});

	test("answers a peer's messages in order, one turn at a time", async () => {
		const { worker, sent, sessions } = harness({ answers: ["one", "two"], holdFirst: true });
		worker.enqueue(item("first"));
		worker.enqueue(item("second"));
		await settle();
		// The first turn is still running: the second is queued, not started.
		expect(sessions[0]?.prompts).toEqual(["first"]);
		expect(worker.state("alice@im.wechat")).toMatchObject({ status: "running", queued: 1 });

		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[0]?.prompts).toEqual(["first", "second"]);
		expect(sent.map((message) => message.text)).toEqual(["one", "two"]);
	});

	test("keeps peers independent", async () => {
		const { worker, sent, opened } = harness({ answers: ["for alice", "for bob"] });
		worker.enqueue(item("hi", "alice@im.wechat"));
		worker.enqueue(item("hi", "bob@im.wechat"));
		await settle();
		expect(opened).toEqual(["alice@im.wechat", "bob@im.wechat"]);
		expect(sent).toHaveLength(2);
	});

	test("says noText when the turn produced nothing", async () => {
		const { worker, sent } = harness({ answers: [""] });
		worker.enqueue(item("ping"));
		await settle();
		expect(sent[0]?.text).toBe("fallback:noText");
	});

	test("says failed and keeps the queue moving when a turn throws", async () => {
		const sent: Array<{ peer: string; text: string }> = [];
		const notices: string[] = [];
		let calls = 0;
		const worker = createPeerWorker({
			openSession: async () => {
				const fake = fakeSession({ answers: ["after"] });
				const original = fake.session.prompt.bind(fake.session);
				fake.session.prompt = async (content: unknown) => {
					calls += 1;
					if (calls === 1) throw new Error("model exploded");
					await original(content);
				};
				return fake.peerSession;
			},
			send: async (target, text) => {
				sent.push({ peer: target.peer, text });
			},
			fallback: (_target, reason) => `fallback:${reason}`,
			notify: (message) => notices.push(message),
			idleTimeoutMs: 0,
		});
		worker.enqueue(item("first"));
		worker.enqueue(item("second"));
		await settle();
		await settle();

		// The failed turn is answered, the failure is on the terminal, and the queued
		// message still gets its own turn.
		expect(sent.map((message) => message.text)).toEqual(["fallback:failed", "after"]);
		expect(notices[0]).toContain("model exploded");
		void worker;
	});

	test("stops the running turn on abort and reports it as stopped", async () => {
		const { worker, sent } = harness({ holdFirst: true });
		worker.enqueue(item("long task"));
		await settle();
		expect(worker.state("alice@im.wechat").status).toBe("running");
		expect(worker.abort("alice@im.wechat")).toBe(true);
		await settle();
		await settle();
		expect(sent[0]?.text).toBe("fallback:stopped");
		// Nothing is running afterwards.
		expect(worker.state("alice@im.wechat").status).toBe("idle");
		expect(worker.abort("alice@im.wechat")).toBe(false);
	});

	test("disposes an idle session after the timeout, and reopens on the next message", async () => {
		const { worker, opened, sessions, timers } = harness({ answers: ["a", "b"], idleTimeoutMs: 1000 });
		worker.enqueue(item("first"));
		await settle();
		expect(timers).toHaveLength(1);
		timers[0]?.fn();
		expect(sessions[0]?.disposed()).toBe(1);

		worker.enqueue(item("second"));
		await settle();
		expect(opened).toEqual(["alice@im.wechat", "alice@im.wechat"]);
	});

	test("reports queued and running state for the control screen", async () => {
		const { worker } = harness({ answers: ["x"], holdFirst: true });
		expect(worker.state("alice@im.wechat")).toEqual({ status: "idle", queued: 0 });
		worker.enqueue(item("one"));
		await settle();
		expect(worker.state("alice@im.wechat")).toMatchObject({ status: "running", queued: 0 });
	});

	test("close drops every session and stops draining", async () => {
		const { worker, sessions } = harness({ answers: ["never"], holdFirst: true });
		worker.enqueue(item("one"));
		await settle();
		await worker.close();
		expect(sessions[0]?.disposed()).toBe(1);
		worker.enqueue(item("after close"));
		await settle();
		expect(worker.state("alice@im.wechat")).toEqual({ status: "idle", queued: 0 });
	});
});
