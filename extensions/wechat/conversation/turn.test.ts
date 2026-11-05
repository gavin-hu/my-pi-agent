/**
 * The worker that drives the chat: how its turns queue, stream, stop, and settle.
 */

import { describe, expect, test } from "bun:test";
import { settle, waitFor } from "../../../test/helpers/process.ts";
import type { ChatSession } from "../host/chat.ts";
import { createTurnRunner, type ChatItem } from "./turn.ts";

describe("turn runner", () => {
	function peerItem(text: string, peer = "alice@im.wechat"): ChatItem {
		return { peer, text, language: "en" };
	}

	/** A session double: `prompt` resolves with the scripted answer, or waits. */
	function workerSession(options: { answers?: string[]; holdFirst?: boolean } = {}) {
		const prompts: unknown[] = [];
		let aborts = 0;
		let disposals = 0;
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
				aborts += 1;
				for (const resolve of waiters.splice(0)) resolve();
			},
			/** Let a held prompt finish normally. */
			release(): void {
				for (const resolve of waiters.splice(0)) resolve();
			},
			dispose(): void {
				disposals += 1;
			},
		};
		return {
			chatTurn: {
				session: session as unknown as ChatSession,
				dispose: async () => session.dispose(),
			} as never,
			session,
			emit,
			emitEvent,
			release: () => session.release(),
			prompts,
			aborts: () => aborts,
			disposed: () => disposals,
		};
	}

	function workerHarness(
		options: {
			answers?: string[];
			holdFirst?: boolean;
			/** Hold the first session open, so a test can act before it exists. */
			holdOpen?: boolean;
			/** Fail the first open, and answer the next message normally. */
			failFirstOpen?: boolean;
			idleTimeoutMs?: number;
			/** Whether the transport accepts a part; defaults to yes. */
			accept?: (text: string) => boolean;
			/** How a send ends: accepted, thrown, or held until its signal aborts. */
			send?: "accept" | "throw" | "untilAborted";
			/** Hold the first delivery open, so a test can act while the answer is going out. */
			holdSend?: boolean;
		} = {},
	) {
		const sent: Array<{ peer: string; text: string }> = [];
		const notices: string[] = [];
		const opened: Array<{ peer: string }> = [];
		const sessions: ReturnType<typeof workerSession>[] = [];
		const timers: Array<{ ms: number; fn: () => void }> = [];
		const openWaiters: Array<() => void> = [];
		const sendWaiters: Array<() => void> = [];
		const worker = createTurnRunner({
			openChat: async (peer) => {
				opened.push({ peer });
				if (options.holdOpen && opened.length === 1) {
					await new Promise<void>((resolve) => openWaiters.push(resolve));
				}
				if (options.failFirstOpen && opened.length === 1) throw new Error("could not open the session");
				const fake = workerSession(options);
				sessions.push(fake);
				return fake.chatTurn;
			},
			send: async (target, text, sendOptions) => {
				sent.push({ peer: target.peer, text });
				if (options.send === "throw") throw new Error("transport down");
				if (options.holdSend && sent.length === 1) {
					await new Promise<void>((resolve) => sendWaiters.push(resolve));
				}
				if (options.send === "untilAborted") {
					await new Promise<void>((resolve, reject) => {
						if (!sendOptions?.signal) {
							resolve();
							return;
						}
						sendOptions.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					});
				}
				return options.accept?.(text) ?? true;
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
		return {
			worker,
			sent,
			notices,
			opened,
			sessions,
			timers,
			releaseOpen: () => {
				for (const resolve of openWaiters.splice(0)) resolve();
			},
			releaseSend: () => {
				for (const resolve of sendWaiters.splice(0)) resolve();
			},
		};
	}

	test("opens one session per peer and answers there", async () => {
		const { worker, sent, opened } = workerHarness({ answers: ["pong"] });
		worker.enqueue(peerItem("ping"));
		await settle();
		expect(opened).toEqual([{ peer: "alice@im.wechat" }]);
		expect(sent).toEqual([{ peer: "alice@im.wechat", text: "pong" }]);
	});

	test("answers each queued message in its own turn", async () => {
		const { worker, sent, sessions } = workerHarness({ answers: ["one", "two", "three"], holdFirst: true });
		worker.enqueue(peerItem("first"));
		// The first turn started; these two are waiting as separate turns.
		worker.enqueue(peerItem("second"));
		worker.enqueue(peerItem("third"));
		await settle();
		sessions[0]?.release();
		await waitFor(() => sent.length === 3);
		expect(sessions[0]?.prompts).toEqual(["first", "second", "third"]);
		expect(sent.map((message) => message.text)).toEqual(["one", "two", "three"]);
	});

	test("flushes buffered text before a prompt is sent", async () => {
		const { worker, sent, sessions } = workerHarness({ answers: [""], holdFirst: true });
		worker.enqueue(peerItem("work"));
		await settle();
		sessions[0]?.emit("partial answer");
		await settle();
		expect(sent).toEqual([]);
		await worker.flush();
		expect(sent.map((message) => message.text)).toEqual(["partial answer"]);
		sessions[0]?.release();
		await settle();
	});

	test("sends each paragraph as it arrives, instead of one lump", async () => {
		const { worker, sent, sessions } = workerHarness({ holdFirst: true, answers: [""] });
		worker.enqueue(peerItem("tell me a story"));
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
		const { worker, sent, sessions } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("long answer"));
		await settle();

		sessions[0]?.emit("first bit\n\n");
		await settle();
		expect(worker.abort()).toBe(true);
		await settle();
		await settle();

		// What already went out stays; nothing else is sent except the stop line.
		expect(sent.map((message) => message.text)).toEqual(["first bit", "fallback:stopped"]);
	});

	test("puts the attachment line on the first part only", async () => {
		const { worker, sent, sessions } = workerHarness({ holdFirst: true, answers: [""] });
		worker.enqueue({ ...peerItem("look"), prefix: "one attachment was unreadable" });
		await settle();

		sessions[0]?.emit("first\n\n");
		sessions[0]?.emit("second");
		sessions[0]?.release();
		await settle();
		await settle();

		expect(sent.map((message) => message.text)).toEqual(["one attachment was unreadable\n\nfirst", "second"]);
	});

	test("stops a stream once a part is rejected", async () => {
		const { worker, sent, sessions } = workerHarness({
			holdFirst: true,
			answers: [""],
			accept: () => false,
		});
		worker.enqueue(peerItem("go"));
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
		let resolveOpen: ((session: never) => void) | undefined;
		const worker = createTurnRunner({
			openChat: async () =>
				await new Promise<never>((resolve) => {
					resolveOpen = resolve;
				}),
			send: async () => true,
			fallback: (_target, reason) => `fallback:${reason}`,
			idleTimeoutMs: 0,
		});
		worker.enqueue(peerItem("slow to open"));
		await settle();
		// The bridge closes while the session is still being built.
		await worker.close();
		resolveOpen?.({
			session: { dispose: () => disposed.push(1) } as never,
			dispose: async () => void disposed.push(1),
		} as never);
		await settle();
		await settle();
		// The late session is disposed instead of leaking, and the turn reports failure.
		expect(disposed).toHaveLength(1);
	});

	test("answers a peer's messages in order, one turn at a time", async () => {
		const { worker, sent, sessions } = workerHarness({ answers: ["one", "two"], holdFirst: true });
		worker.enqueue(peerItem("first"));
		worker.enqueue(peerItem("second"));
		await settle();
		// The first turn is still running: the second is queued, not started.
		expect(sessions[0]?.prompts).toEqual(["first"]);
		expect(worker.state()).toMatchObject({ status: "running", queued: 1 });

		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[0]?.prompts).toEqual(["first", "second"]);
		expect(sent.map((message) => message.text)).toEqual(["one", "two"]);
	});

	test("says noText when the turn produced nothing", async () => {
		const { worker, sent } = workerHarness({ answers: [""] });
		worker.enqueue(peerItem("ping"));
		await settle();
		expect(sent[0]?.text).toBe("fallback:noText");
	});

	test("says the conversation was compacted after the answer", async () => {
		const sent: Array<{ peer: string; text: string }> = [];
		const fake = workerSession({ answers: ["answer"] });
		const original = fake.session.prompt.bind(fake.session);
		fake.session.prompt = async (content: unknown) => {
			fake.emitEvent({ type: "compaction_end", reason: "threshold", result: undefined, aborted: false });
			await original(content);
		};
		const worker = createTurnRunner({
			openChat: async () => fake.chatTurn,
			send: async (target, text) => {
				sent.push({ peer: target.peer, text });
				return true;
			},
			fallback: (_item, reason) => `fallback:${reason}`,
			armTimer: () => () => {},
		});
		worker.enqueue(peerItem("ping"));
		await settle();
		await settle();
		expect(sent.map((entry) => entry.text)).toEqual(["answer", "fallback:compacted"]);
	});

	test("says failed and keeps the queue moving when a turn throws", async () => {
		const sent: Array<{ peer: string; text: string }> = [];
		const notices: string[] = [];
		let calls = 0;
		const worker = createTurnRunner({
			openChat: async () => {
				const fake = workerSession({ answers: ["after"] });
				const original = fake.session.prompt.bind(fake.session);
				fake.session.prompt = async (content: unknown) => {
					calls += 1;
					if (calls === 1) throw new Error("model exploded");
					await original(content);
				};
				return fake.chatTurn;
			},
			send: async (target, text) => {
				sent.push({ peer: target.peer, text });
				return true;
			},
			fallback: (_target, reason) => `fallback:${reason}`,
			notify: (message) => notices.push(message),
			idleTimeoutMs: 0,
		});
		worker.enqueue(peerItem("first"));
		worker.enqueue(peerItem("second"));
		await settle();
		await settle();

		// The failed turn is answered, the failure is on the terminal, and the queued
		// message still gets its own turn.
		expect(sent.map((message) => message.text)).toEqual(["fallback:failed", "after"]);
		expect(notices[0]).toContain("model exploded");
	});

	test("stops the running turn on abort and reports it as stopped", async () => {
		const { worker, sent } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("long task"));
		await settle();
		expect(worker.state().status).toBe("running");
		expect(worker.abort()).toBe(true);
		await settle();
		await settle();
		expect(sent[0]?.text).toBe("fallback:stopped");
		// Nothing is running afterwards.
		expect(worker.state().status).toBe("idle");
		expect(worker.abort()).toBe(false);
	});

	test("takes a stop that arrives while the session is still opening", async () => {
		const { worker, sent, sessions, releaseOpen } = workerHarness({ holdOpen: true, answers: ["too late"] });
		worker.enqueue(peerItem("long task"));
		await settle();
		// The turn is running, but the session it needs does not exist yet.
		expect(worker.state().status).toBe("running");
		expect(worker.abort()).toBe(true);

		releaseOpen();
		await settle();
		await settle();
		// The prompt never ran, and the peer hears the turn stopped, once.
		expect(sessions[0]?.prompts).toEqual([]);
		expect(sent.map((message) => message.text)).toEqual(["fallback:stopped"]);
		expect(worker.state().status).toBe("idle");
	});

	test("a stop during the answer's delivery does not reach the next turn", async () => {
		const { worker, sent, sessions, releaseSend } = workerHarness({
			answers: ["answer", "pong"],
			holdFirst: true,
			holdSend: true,
		});
		worker.enqueue(peerItem("first"));
		await settle();
		// The prompt has produced its answer, and that answer is on its way out.
		sessions[0]?.release();
		await settle();
		expect(sent.map((message) => message.text)).toEqual(["answer"]);

		// Nothing consumes a mark made this late: the turn it belongs to is over.
		expect(worker.abort()).toBe(true);
		releaseSend();
		await settle();
		await settle();
		expect(sent.map((message) => message.text)).toEqual(["answer"]);

		// The next turn prompts and answers normally instead of saying it stopped.
		worker.enqueue(peerItem("second"));
		await settle();
		expect(sessions[0]?.prompts).toEqual(["first", "second"]);
		expect(sent.map((message) => message.text)).toEqual(["answer", "pong"]);
	});

	test("a stop does not outlive a session that failed to open", async () => {
		const { worker, sent, notices, releaseOpen } = workerHarness({
			holdOpen: true,
			failFirstOpen: true,
			answers: ["pong"],
		});
		worker.enqueue(peerItem("first"));
		await settle();
		expect(worker.abort()).toBe(true);

		releaseOpen();
		await settle();
		await settle();
		// The failed open reports the failure, not the stop that came before it.
		expect(sent.map((message) => message.text)).toEqual(["fallback:failed"]);
		expect(notices[0]).toContain("could not open the session");

		worker.enqueue(peerItem("second"));
		await settle();
		expect(sent.map((message) => message.text)).toEqual(["fallback:failed", "pong"]);
	});

	test("disposes an idle session after the timeout, and reopens on the next message", async () => {
		const { worker, opened, sessions, timers } = workerHarness({ answers: ["a", "b"], idleTimeoutMs: 1000 });
		worker.enqueue(peerItem("first"));
		await settle();
		expect(timers).toHaveLength(1);
		timers[0]?.fn();
		expect(sessions[0]?.disposed()).toBe(1);

		worker.enqueue(peerItem("second"));
		await settle();
		expect(opened.map((entry) => entry.peer)).toEqual(["alice@im.wechat", "alice@im.wechat"]);
	});

	test("reports queued and running state for the control screen", async () => {
		const { worker } = workerHarness({ answers: ["x"], holdFirst: true });
		expect(worker.state()).toEqual({ status: "idle", queued: 0 });
		worker.enqueue(peerItem("one"));
		await settle();
		expect(worker.state()).toMatchObject({ status: "running", queued: 0 });
		worker.enqueue(peerItem("two"));
		expect(worker.state()).toMatchObject({ status: "running", queued: 1 });
	});

	test("close drops every session and stops draining", async () => {
		const { worker, sessions } = workerHarness({ answers: ["never"], holdFirst: true });
		worker.enqueue(peerItem("one"));
		await settle();
		await worker.close();
		expect(sessions[0]?.disposed()).toBe(1);
		worker.enqueue(peerItem("after close"));
		await settle();
		expect(worker.state()).toEqual({ status: "idle", queued: 0 });
	});

	test("tells the chat once when an abandoning close ends its turn", async () => {
		const { worker, sent } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("first"));
		worker.enqueue(peerItem("second"));
		await settle();
		await worker.close({ abandon: true });

		// One line for the conversation, not one per message.
		expect(sent.map((message) => `${message.peer} ${message.text}`)).toEqual(["alice@im.wechat fallback:abandoned"]);
	});

	test("says nothing on an abandoning close once the answer has arrived", async () => {
		const { worker, sent } = workerHarness({ answers: ["pong"] });
		worker.enqueue(peerItem("ping"));
		await waitFor(() => sent.length === 1);
		await worker.close({ abandon: true });
		expect(sent.map((message) => message.text)).toEqual(["pong"]);
	});

	test("says nothing when the close is not an abandonment", async () => {
		// The expiry reconnect closes the old worker and opens a new one; its token is
		// dead, so a notice there could only fail.
		const { worker, sent } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("one"));
		await settle();
		await worker.close();
		expect(sent).toEqual([]);
	});

	test("reports an abandon notice the transport threw, once", async () => {
		const { worker, notices } = workerHarness({ holdFirst: true, send: "throw" });
		worker.enqueue(peerItem("one"));
		await settle();
		await worker.close({ abandon: true });
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("could not tell alice@im.wechat");
	});

	test("gives up on an abandon notice that never settles, and says so once", async () => {
		const { worker, notices, timers } = workerHarness({ holdFirst: true, send: "untilAborted" });
		worker.enqueue(peerItem("one"));
		await settle();
		const closing = worker.close({ abandon: true });
		// The shutdown waits on the notice until its own deadline, then reports it.
		await settle();
		expect(timers.find((timer) => timer.ms === 5000)).toBeDefined();
		timers.find((timer) => timer.ms === 5000)?.fn();
		await closing;
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("no reply in 5 s");
	});
});
