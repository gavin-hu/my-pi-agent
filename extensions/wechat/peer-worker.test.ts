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
	const listeners: Array<(event: unknown) => void> = [];
	const emit = (delta: string): void => {
		if (!delta) return;
		for (const listener of listeners) {
			listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
		}
	};
	/** Emit an arbitrary session event, for compaction and other non-text events. */
	const emitEvent = (event: unknown): void => {
		for (const listener of listeners) listener(event);
	};
	const session = {
		isIdle: true,
		getLastAssistantText: () => last,
		subscribe(listener: (event: unknown) => void): () => void {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		async prompt(content: unknown): Promise<void> {
			prompts.push(content);
			if (options.holdFirst && prompts.length === 1) {
				await new Promise<void>((resolve) => waiters.push(resolve));
			}
			last = options.answers?.shift() ?? "";
			// Stream the answer like a provider would, then finish.
			emit(last);
		},
		async abort(): Promise<void> {
			abort += 1;
			for (const resolve of waiters.splice(0)) resolve();
		},
		/** Let a held prompt finish normally. */
		release(): void {
			for (const resolve of waiters.splice(0)) resolve();
		},
		dispose(): void {
			disposed += 1;
		},
	};
	return {
		peerSession: { session: session as unknown as AgentSession, dispose: () => session.dispose() } as PeerSession,
		session,
		emit,
		emitEvent,
		release: () => session.release(),
		prompts,
		aborts: () => abort,
		disposed: () => disposed,
	};
}

function harness(
	options: {
		answers?: string[];
		holdFirst?: boolean;
		idleTimeoutMs?: number;
		concurrency?: number;
		/** Whether the transport accepts a part; defaults to yes. */
		accept?: (text: string) => boolean;
	} = {},
) {
	const sent: Array<{ peer: string; text: string }> = [];
	const notices: string[] = [];
	const opened: Array<{ peer: string; fresh: boolean }> = [];
	const sessions: ReturnType<typeof fakeSession>[] = [];
	const timers: Array<{ ms: number; fn: () => void }> = [];
	const worker = createPeerWorker({
		openSession: async (peer, sessionOptions) => {
			opened.push({ peer, fresh: sessionOptions.fresh });
			const fake = fakeSession(options);
			sessions.push(fake);
			return fake.peerSession;
		},
		send: async (target, text) => {
			sent.push({ peer: target.peer, text });
			return options.accept?.(text) ?? true;
		},
		fallback: (_target, reason) => `fallback:${reason}`,
		notify: (message) => notices.push(message),
		concurrency: options.concurrency,
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
		expect(opened).toEqual([{ peer: "alice@im.wechat", fresh: false }]);
		expect(sent).toEqual([{ peer: "alice@im.wechat", text: "pong" }]);
	});

	test("merges a burst that arrives while the peer is still waiting", async () => {
		const { worker, sent, sessions } = harness({ answers: ["one", "two"], holdFirst: true });
		worker.enqueue(item("first"));
		// The first turn started; these two are waiting and merge into one turn.
		worker.enqueue(item("second"));
		worker.enqueue(item("third"));
		await settle();
		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[0]?.prompts).toEqual(["first", "second\nthird"]);
		expect(sent.map((message) => message.text)).toEqual(["one", "two"]);
	});

	test("sends each paragraph as it arrives, instead of one lump", async () => {
		const { worker, sent, sessions } = harness({ holdFirst: true, answers: [""] });
		worker.enqueue(item("tell me a story"));
		await settle();

		// The provider streams: the first paragraph is out while the turn runs.
		sessions[0]?.emit("Once upon a time.\n\n");
		sessions[0]?.emit("The end.");
		await settle();
		expect(sent.map((message) => message.text)).toEqual(["Once upon a time."]);

		sessions[0]?.release();
		await settle();
		await settle();
		// The remainder follows at the end, and nothing is sent twice.
		expect(sent.map((message) => message.text)).toEqual(["Once upon a time.", "The end."]);
	});

	test("drops the unsent remainder when the peer stops the turn", async () => {
		const { worker, sent, sessions } = harness({ holdFirst: true });
		worker.enqueue(item("long answer"));
		await settle();

		sessions[0]?.emit("first bit\n\n");
		await settle();
		expect(worker.abort("alice@im.wechat")).toBe(true);
		await settle();
		await settle();

		// What already went out stays; nothing else is sent except the stop line.
		expect(sent.map((message) => message.text)).toEqual(["first bit", "fallback:stopped"]);
	});

	test("puts the attachment line on the first part only", async () => {
		const { worker, sent, sessions } = harness({ holdFirst: true, answers: [""] });
		worker.enqueue({ ...item("look"), prefix: "one attachment was unreadable" });
		await settle();

		sessions[0]?.emit("first\n\n");
		sessions[0]?.emit("second");
		sessions[0]?.release();
		await settle();
		await settle();

		expect(sent.map((message) => message.text)).toEqual(["one attachment was unreadable\n\nfirst", "second"]);
	});

	test("stops a stream once a part is rejected", async () => {
		const { worker, sent, sessions } = harness({
			holdFirst: true,
			answers: [""],
			accept: () => false,
		});
		worker.enqueue(item("go"));
		await settle();

		sessions[0]?.emit("first\n\n");
		sessions[0]?.emit("second");
		sessions[0]?.release();
		await settle();
		await settle();

		// The transport rejected the first part, so the second is not attempted.
		expect(sent.map((message) => message.text)).toEqual(["first"]);
	});

	test("disposes a session that finishes opening after close", async () => {
		const disposed: number[] = [];
		let resolveOpen: ((session: PeerSession) => void) | undefined;
		const worker = createPeerWorker({
			openSession: async () =>
				await new Promise<PeerSession>((resolve) => {
					resolveOpen = resolve;
				}),
			send: async () => true,
			fallback: (_target, reason) => `fallback:${reason}`,
			idleTimeoutMs: 0,
		});
		worker.enqueue(item("slow to open"));
		await settle();
		// The bridge closes while the session is still being built.
		await worker.close();
		resolveOpen?.({
			session: { dispose: () => disposed.push(1) } as never,
			dispose: () => disposed.push(1),
		});
		await settle();
		await settle();
		// The late session is disposed instead of leaking, and the turn reports failure.
		expect(disposed).toHaveLength(1);
	});

	test("reports the running turn and hands the slot to the next peer", async () => {
		const { worker, sessions } = harness({ holdFirst: true });
		worker.enqueue(item("alice task", "alice@im.wechat"));
		worker.enqueue(item("bob task", "bob@im.wechat"));
		await settle();
		// One turn at a time by default, so a forwarded dialog has one owner.
		expect(worker.current()?.text).toBe("alice task");
		expect(sessions).toHaveLength(1);

		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[1]?.prompts).toEqual(["bob task"]);
	});

	test("runs peers in parallel when the concurrency allows it", async () => {
		const { worker, sessions } = harness({ holdFirst: true, concurrency: 2 });
		worker.enqueue(item("alice task", "alice@im.wechat"));
		worker.enqueue(item("bob task", "bob@im.wechat"));
		await settle();
		expect(sessions).toHaveLength(2);
		expect(sessions[1]?.prompts).toEqual(["bob task"]);
	});

	test("reset starts a fresh conversation and drops what was queued", async () => {
		const { worker, opened, sessions } = harness({ answers: ["old", "new"] });
		worker.enqueue(item("before"));
		await settle();
		expect(worker.reset("alice@im.wechat")).toBe(true);
		expect(sessions[0]?.disposed()).toBe(1);

		worker.enqueue(item("after"));
		await settle();
		expect(opened).toEqual([
			{ peer: "alice@im.wechat", fresh: false },
			{ peer: "alice@im.wechat", fresh: true },
		]);
	});

	test("reset is refused while a turn runs", async () => {
		const { worker } = harness({ holdFirst: true });
		worker.enqueue(item("long task"));
		await settle();
		expect(worker.reset("alice@im.wechat")).toBe(false);
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
		await settle();
		expect(opened.map((entry) => entry.peer)).toEqual(["alice@im.wechat", "bob@im.wechat"]);
		expect(sent).toHaveLength(2);
	});

	test("says noText when the turn produced nothing", async () => {
		const { worker, sent } = harness({ answers: [""] });
		worker.enqueue(item("ping"));
		await settle();
		expect(sent[0]?.text).toBe("fallback:noText");
	});

	test("says the conversation was compacted after the answer", async () => {
		const sent: Array<{ peer: string; text: string }> = [];
		const fake = fakeSession({ answers: ["answer"] });
		const original = fake.session.prompt.bind(fake.session);
		fake.session.prompt = async (content: unknown) => {
			fake.emitEvent({ type: "compaction_end", reason: "threshold", result: undefined, aborted: false });
			await original(content);
		};
		const worker = createPeerWorker({
			openSession: async () => fake.peerSession,
			send: async (target, text) => {
				sent.push({ peer: target.peer, text });
				return true;
			},
			fallback: (_item, reason) => `fallback:${reason}`,
			armTimer: () => () => {},
		});
		worker.enqueue(item("ping"));
		await settle();
		await settle();
		expect(sent.map((entry) => entry.text)).toEqual(["answer", "fallback:compacted"]);
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
				return true;
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
		expect(opened.map((entry) => entry.peer)).toEqual(["alice@im.wechat", "alice@im.wechat"]);
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
