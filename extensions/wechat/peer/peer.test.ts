/**
 * A peer's own session and the worker that drives it: what the session is built
 * with, and how its turns queue, stream, stop, and settle.
 */

import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AgentSession, CreateAgentSessionOptions, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../../../test/helpers/env.ts";
import { settle, waitFor } from "../../../test/helpers/process.ts";
import { WECHAT_CHANNEL_PROMPT } from "../text/channel.ts";
import {
	buildPeerLoader,
	isWechatExtensionPath,
	openPeerSession,
	peerSessionDir,
	withoutWechatExtensions,
} from "./peer-session.ts";
import { createPeerWorker, type PeerItem } from "./peer-worker.ts";

describe("peer session", () => {
	const peer = "o9cq805LvMzHEsv0mfq0XwZPJruI@im.wechat";

	interface Bound {
		mode?: string;
		uiContext?: { custom: unknown };
		onError?: (error: { extensionPath: string; event: string; error: string }) => void;
	}

	function sessionDouble(tools = [{ name: "read", exposure: "direct" }]): {
		session: AgentSession;
		bound: () => Bound | undefined;
		disposed: () => number;
		active: () => string[];
	} {
		let bound: Bound | undefined;
		let disposals = 0;
		let active = tools.filter((tool) => tool.exposure === "direct").map((tool) => tool.name);
		const session = {
			bindExtensions: async (bindings: Bound) => {
				bound = bindings;
			},
			getActiveToolNames: () => [...active],
			getAllTools: () => tools,
			setActiveToolsByName: (names: string[]) => {
				active = [...names];
			},
			// `disposal.test.ts` owns what a session's extensions hear on the way out.
			extensionRunner: { hasHandlers: () => false, emit: async () => {} },
			dispose: () => void (disposals += 1),
		};
		return {
			session: session as unknown as AgentSession,
			bound: () => bound,
			disposed: () => disposals,
			active: () => [...active],
		};
	}

	function extensionSet(paths: string[]): LoadExtensionsResult {
		return {
			extensions: paths.map((path) => ({ path, resolvedPath: path })),
			errors: [],
			runtime: {},
		} as unknown as LoadExtensionsResult;
	}

	test("recognizes this bridge and nothing else", () => {
		const root = "/repo/extensions";
		expect(isWechatExtensionPath(`${root}/wechat/index.ts`)).toBe(true);
		expect(isWechatExtensionPath(`${root}/wechat/index.js`)).toBe(true);
		expect(isWechatExtensionPath("C:\\repo\\extensions\\wechat\\index.ts")).toBe(true);
		expect(isWechatExtensionPath(`${root}/plan/index.ts`)).toBe(false);
		expect(isWechatExtensionPath(`${root}/wechat/commands.ts`)).toBe(false);
		expect(isWechatExtensionPath(`${root}/notwechat/index.ts`)).toBe(false);
	});

	test("drops only this bridge from the loaded set", () => {
		const base = extensionSet([
			"/repo/extensions/wechat/index.ts",
			"/repo/extensions/plan/index.ts",
			"/repo/extensions/todo/index.ts",
		]);
		const kept = withoutWechatExtensions(base);
		expect(kept.extensions.map((extension) => extension.resolvedPath)).toEqual([
			"/repo/extensions/plan/index.ts",
			"/repo/extensions/todo/index.ts",
		]);
		expect(kept.runtime).toBe(base.runtime);
		const untouched = extensionSet(["/repo/extensions/plan/index.ts"]);
		expect(withoutWechatExtensions(untouched)).toBe(untouched);
	});

	test("gives each peer its own normalised session directory", () => {
		const root = tempDir("wechat-sessions-");
		expect(peerSessionDir(root, peer)).toBe(join(root, "o9cq805lvmzhesv0mfq0xwzpjrui"));
		expect(peerSessionDir(root, "alice")).toBe(join(root, "alice"));
	});

	test("appends the channel contract and keeps it across reload", async () => {
		const root = tempDir("wechat-loader-");
		const loader = buildPeerLoader(root, root);
		// `reload()` is what openPeerSession calls before creating the session; the
		// append must survive it, or the model never sees the channel contract.
		await loader.reload();
		expect(loader.getAppendSystemPrompt()).toEqual([WECHAT_CHANNEL_PROMPT]);
	});

	test("creates the session from the workspace and binds the peer's dialogs", async () => {
		const root = tempDir("wechat-peer-");
		const fake = sessionDouble();
		const created: CreateAgentSessionOptions[] = [];
		const loaders: Array<[string, string]> = [];
		const uiContext = { custom: () => undefined } as never;
		let reloads = 0;
		const loaded = { reload: async () => void (reloads += 1) } as never;

		const opened = await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext,
			seams: {
				create: async (options) => {
					created.push(options as CreateAgentSessionOptions);
					return { session: fake.session } as never;
				},
				loader: ((cwd: string, agentDir: string) => {
					loaders.push([cwd, agentDir]);
					return loaded;
				}) as never,
			},
		});

		expect(loaders).toEqual([[root, root]]);
		// A fresh loader has discovered nothing yet, so it must be reloaded first.
		expect(reloads).toBe(1);
		expect(created[0]?.cwd).toBe(root);
		expect(created[0]?.resourceLoader).toBe(loaded);
		// The peer answers their own dialogs: the UI context is theirs, in RPC mode
		// (dialogs are forwarded, custom components are not).
		expect(fake.bound()?.mode).toBe("rpc");
		expect(fake.bound()?.uiContext).toBe(uiContext);

		await opened.dispose();
		expect(fake.disposed()).toBe(1);
	});

	test("activates the tools the extensions registered", async () => {
		const root = tempDir("wechat-peer-");
		const fake = sessionDouble([
			{ name: "read", exposure: "direct" },
			{ name: "todo", exposure: "direct" },
			{ name: "open_path", exposure: "codemode" },
		]);
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		// The peer gets the package's tools; a codemode tool stays as it was.
		expect(fake.active().sort()).toEqual(["read", "todo"]);
	});

	test("keeps only the allowlisted tools, and warns on unknown names", async () => {
		const root = tempDir("wechat-peer-");
		const fake = sessionDouble([
			{ name: "read", exposure: "direct" },
			{ name: "todo", exposure: "direct" },
			{ name: "open_path", exposure: "codemode" },
		]);
		const warnings: string[] = [];
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			toolAllowlist: ["todo", "open_path", "nope"],
			onWarning: (message) => warnings.push(message),
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		// `open_path` is codemode, so it was not active to begin with; the allowlist
		// keeps the intersection rather than activating it.
		expect(fake.active()).toEqual(["todo"]);
		expect(warnings[0]).toContain("unknown tools: nope");
	});

	test("an allowlist of unknown names leaves no tools", async () => {
		const root = tempDir("wechat-peer-");
		const fake = sessionDouble([{ name: "read", exposure: "direct" }]);
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			toolAllowlist: ["nope"],
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});
		expect(fake.active()).toEqual([]);
	});

	test("reports an extension error with where it happened", async () => {
		const root = tempDir("wechat-peer-");
		const messages: string[] = [];
		const fake = sessionDouble();
		await openPeerSession(peer, {
			cwd: root,
			agentDir: root,
			sessionsDir: join(root, "sessions"),
			uiContext: {} as never,
			onError: (message) => messages.push(message),
			seams: {
				create: async () => ({ session: fake.session }) as never,
				loader: (() => ({ reload: async () => {} })) as never,
			},
		});

		fake.bound()?.onError?.({
			extensionPath: "/repo/extensions/web-access/index.ts",
			event: "session_start",
			error: "boom",
		});
		expect(messages).toEqual(["web-access/index.ts (session_start): boom"]);
	});
});

describe("peer worker", () => {
	function peerItem(text: string, peer = "alice@im.wechat"): PeerItem {
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
			peerSession: {
				session: session as unknown as AgentSession,
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
			concurrency?: number;
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
		const opened: Array<{ peer: string; fresh: boolean }> = [];
		const sessions: ReturnType<typeof workerSession>[] = [];
		const timers: Array<{ ms: number; fn: () => void }> = [];
		const openWaiters: Array<() => void> = [];
		const sendWaiters: Array<() => void> = [];
		const worker = createPeerWorker({
			openSession: async (peer, sessionOptions) => {
				opened.push({ peer, fresh: sessionOptions.fresh });
				if (options.holdOpen && opened.length === 1) {
					await new Promise<void>((resolve) => openWaiters.push(resolve));
				}
				if (options.failFirstOpen && opened.length === 1) throw new Error("could not open the session");
				const fake = workerSession(options);
				sessions.push(fake);
				return fake.peerSession;
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
		expect(opened).toEqual([{ peer: "alice@im.wechat", fresh: false }]);
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
		await worker.flush("alice@im.wechat");
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
		expect(worker.abort("alice@im.wechat")).toBe(true);
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
		const worker = createPeerWorker({
			openSession: async () =>
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

	test("runs two peers at once, keeps each peer serial, and gives a freed slot to the oldest wait", async () => {
		const { worker, sessions } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("alice task", "alice@im.wechat"));
		worker.enqueue(peerItem("bob task", "bob@im.wechat"));
		worker.enqueue(peerItem("carol task", "carol@im.wechat"));
		await settle();
		// Two turns at once, each on its own peer's session; the third waits.
		expect(sessions).toHaveLength(2);
		expect(worker.state("carol@im.wechat")).toMatchObject({ status: "queued", queued: 1 });

		// Carol queued hers before alice queued a second, so carol takes the free slot:
		// the queue is fair across peers, not first-peer-wins.
		worker.enqueue(peerItem("alice again", "alice@im.wechat"));
		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[2]?.prompts).toEqual(["carol task"]);
		expect(worker.state("alice@im.wechat")).toMatchObject({ status: "queued", queued: 1 });
	});

	test("serializes the turn when the concurrency is one", async () => {
		const { worker, sessions } = workerHarness({ holdFirst: true, concurrency: 1 });
		worker.enqueue(peerItem("alice task", "alice@im.wechat"));
		worker.enqueue(peerItem("bob task", "bob@im.wechat"));
		await settle();
		expect(sessions).toHaveLength(1);

		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[1]?.prompts).toEqual(["bob task"]);
	});

	test("answers a peer's messages in order, one turn at a time", async () => {
		const { worker, sent, sessions } = workerHarness({ answers: ["one", "two"], holdFirst: true });
		worker.enqueue(peerItem("first"));
		worker.enqueue(peerItem("second"));
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
		const { worker, sent, opened } = workerHarness({ answers: ["for alice", "for bob"] });
		worker.enqueue(peerItem("hi", "alice@im.wechat"));
		worker.enqueue(peerItem("hi", "bob@im.wechat"));
		await settle();
		await settle();
		expect(opened.map((entry) => entry.peer)).toEqual(["alice@im.wechat", "bob@im.wechat"]);
		expect(sent).toHaveLength(2);
	});

	test("reset starts a fresh conversation and drops what was queued", async () => {
		const { worker, opened, sessions } = workerHarness({ answers: ["old", "new"] });
		worker.enqueue(peerItem("before"));
		await settle();
		expect(worker.reset("alice@im.wechat")).toBe(true);
		expect(sessions[0]?.disposed()).toBe(1);

		worker.enqueue(peerItem("after"));
		await settle();
		expect(opened).toEqual([
			{ peer: "alice@im.wechat", fresh: false },
			{ peer: "alice@im.wechat", fresh: true },
		]);
	});

	test("reset is refused while a turn runs", async () => {
		const { worker } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("long task"));
		await settle();
		expect(worker.reset("alice@im.wechat")).toBe(false);
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
		const worker = createPeerWorker({
			openSession: async () => fake.peerSession,
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
		const worker = createPeerWorker({
			openSession: async () => {
				const fake = workerSession({ answers: ["after"] });
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
		expect(worker.state("alice@im.wechat").status).toBe("running");
		expect(worker.abort("alice@im.wechat")).toBe(true);
		await settle();
		await settle();
		expect(sent[0]?.text).toBe("fallback:stopped");
		// Nothing is running afterwards.
		expect(worker.state("alice@im.wechat").status).toBe("idle");
		expect(worker.abort("alice@im.wechat")).toBe(false);
	});

	test("takes a stop that arrives while the session is still opening", async () => {
		const { worker, sent, sessions, releaseOpen } = workerHarness({ holdOpen: true, answers: ["too late"] });
		worker.enqueue(peerItem("long task"));
		await settle();
		// The turn is running, but the session it needs does not exist yet.
		expect(worker.state("alice@im.wechat").status).toBe("running");
		expect(worker.abort("alice@im.wechat")).toBe(true);

		releaseOpen();
		await settle();
		await settle();
		// The prompt never ran, and the peer hears the turn stopped, once.
		expect(sessions[0]?.prompts).toEqual([]);
		expect(sent.map((message) => message.text)).toEqual(["fallback:stopped"]);
		expect(worker.state("alice@im.wechat").status).toBe("idle");
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
		expect(worker.abort("alice@im.wechat")).toBe(true);
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
		expect(worker.abort("alice@im.wechat")).toBe(true);

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
		expect(worker.state("alice@im.wechat")).toEqual({ status: "idle", queued: 0 });
		worker.enqueue(peerItem("one"));
		await settle();
		expect(worker.state("alice@im.wechat")).toMatchObject({ status: "running", queued: 0 });
		worker.enqueue(peerItem("two", "bob@im.wechat"));
		expect(
			worker
				.snapshot()
				.map((entry) => entry.peer)
				.sort(),
		).toEqual(["alice@im.wechat", "bob@im.wechat"]);
	});

	test("close drops every session and stops draining", async () => {
		const { worker, sessions } = workerHarness({ answers: ["never"], holdFirst: true });
		worker.enqueue(peerItem("one"));
		await settle();
		await worker.close();
		expect(sessions[0]?.disposed()).toBe(1);
		worker.enqueue(peerItem("after close"));
		await settle();
		expect(worker.state("alice@im.wechat")).toEqual({ status: "idle", queued: 0 });
	});

	test("tells each peer that still had work when an abandoning close ends its turn", async () => {
		const { worker, sent } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("first"));
		worker.enqueue(peerItem("second"));
		worker.enqueue(peerItem("theirs", "bob@im.wechat"));
		await settle();
		await worker.close({ abandon: true });

		// One line per peer, not per message: alice's running turn and her queued one
		// share the one bubble, and bob's never-started turn gets his own.
		expect(sent.map((message) => `${message.peer} ${message.text}`).sort()).toEqual([
			"alice@im.wechat fallback:abandoned",
			"bob@im.wechat fallback:abandoned",
		]);
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
