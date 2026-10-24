import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AgentSession, CreateAgentSessionOptions, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeClock, type Clock } from "../../../test/helpers/clock.ts";
import { account, updates } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import { settle, waitFor } from "../../../test/helpers/process.ts";
import { createAdmissionQueue, createTurnBudget, type TurnBudget } from "./admission.ts";
import { createDeliverer } from "../transport/deliver.ts";
import { WECHAT_CHANNEL_PROMPT } from "../text/channel.ts";
import type { WechatClient } from "../transport/client.ts";
import { acquireLock, isLocked, releaseLock, type LockDeps } from "../state/lock.ts";
import {
	buildPeerLoader,
	isWechatExtensionPath,
	openPeerSession,
	peerSessionDir,
	withoutWechatExtensions,
} from "./peer-session.ts";
import { createPeerWorker, type PeerItem, type PeerState } from "./peer-worker.ts";
import { createPollLoop, defaultPollTimeout } from "../transport/poll.ts";
import { createPresence, type PresenceDeps } from "./presence.ts";
import { createReplyPipeline } from "./reply-pipeline.ts";
import {
	emptyState,
	findPeer,
	readState,
	recordInbound,
	rememberMessage,
	SEEN_MAX,
	SEEN_TTL_MS,
	seenMessage,
	writeState,
} from "../state/state.ts";
import { createTimerMap, defaultSleep, type ArmTimer } from "../timer.ts";
import type { BotCredentials, InboundItem, UpdatesResponse, WeixinMessage } from "../types.ts";

const robot: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function inboundItem(text: string, peer = "alice@im.wechat"): InboundItem {
	return { peer, text, media: [], language: "en" };
}

describe("turn budget", () => {
	function budget(limit: number, clock: Clock): TurnBudget {
		return createTurnBudget(limit, clock.now);
	}

	test("allows every turn when the cap is off", () => {
		const clock = makeClock(1000);
		const turns = budget(0, clock);
		for (let index = 0; index < 20; index++) expect(turns.allow("alice")).toBe(true);
	});

	test("refuses a peer past its rolling-hour allowance", () => {
		const clock = makeClock(1000);
		const turns = budget(2, clock);
		expect(turns.allow("alice")).toBe(true);
		expect(turns.allow("alice")).toBe(true);
		expect(turns.allow("alice")).toBe(false);
		expect(turns.allow("bob")).toBe(true);
	});

	test("counts either id form as one peer", () => {
		const clock = makeClock(1000);
		const turns = budget(2, clock);
		expect(turns.allow("alice@im.wechat")).toBe(true);
		expect(turns.allow("alice")).toBe(true);
		expect(turns.allow("ALICE@im.wechat")).toBe(false);
	});

	test("frees the allowance as the hour rolls", () => {
		const clock = makeClock(1000);
		const turns = budget(1, clock);
		expect(turns.allow("alice")).toBe(true);
		clock.advance(60 * 60 * 1000 + 1);
		expect(turns.allow("alice")).toBe(true);
	});

	test("reset starts a fresh window", () => {
		const clock = makeClock(1000);
		const turns = budget(1, clock);
		expect(turns.allow("alice")).toBe(true);
		turns.reset();
		expect(turns.allow("alice")).toBe(true);
	});
});

describe("admission queue", () => {
	function admissionHarness() {
		const admitted: string[] = [];
		const notices: string[] = [];
		let releaseSlow: (() => void) | undefined;
		const slow = new Promise<void>((resolve) => {
			releaseSlow = resolve;
		});
		const queue = createAdmissionQueue({
			admit: async (item) => {
				admitted.push(item.text);
				if (item.text === "slow") await slow;
				if (item.text === "bad") throw new Error("download failed");
			},
			notify: (message) => notices.push(message),
		});
		return {
			queue,
			admitted,
			notices,
			release: () => releaseSlow?.(),
		};
	}

	test("admits one peer's messages in arrival order even when the first is slow", async () => {
		const { queue, admitted, release } = admissionHarness();
		queue.enqueue(inboundItem("slow"));
		queue.enqueue(inboundItem("fast"));
		await settle();
		expect(admitted).toEqual(["slow"]);
		expect(queue.pending("alice@im.wechat")).toBe(2);

		release();
		await settle();
		expect(admitted).toEqual(["slow", "fast"]);
		expect(queue.pending("alice@im.wechat")).toBe(0);
	});

	test("admits different peers independently", async () => {
		const { queue, admitted, release } = admissionHarness();
		queue.enqueue(inboundItem("slow"));
		queue.enqueue(inboundItem("fast", "bob@im.wechat"));
		await settle();
		expect(admitted).toEqual(["slow", "fast"]);
		release();
	});

	test("reports a failed admission and keeps the peer's chain moving", async () => {
		const { queue, admitted, notices } = admissionHarness();
		queue.enqueue(inboundItem("bad"));
		queue.enqueue(inboundItem("after"));
		await settle();
		await settle();
		expect(admitted).toEqual(["bad", "after"]);
		expect(notices[0]).toContain("download failed");
		expect(queue.pending("alice@im.wechat")).toBe(0);
	});

	test("reset drops the reserved slots", async () => {
		const { queue, release } = admissionHarness();
		queue.enqueue(inboundItem("slow"));
		await settle();
		expect(queue.pending("alice@im.wechat")).toBe(1);
		queue.reset();
		expect(queue.pending("alice@im.wechat")).toBe(0);
		release();
	});
});

describe("poller lock", () => {
	function newPath(): string {
		return join(tempDir("wechat-lock-"), "poller.lock");
	}

	function lockDeps(overrides: Partial<LockDeps> = {}): LockDeps {
		return { now: () => 1000, pid: 1, isAlive: () => true, staleMs: 100, ...overrides };
	}

	test("acquires when no lock exists", () => {
		const path = newPath();
		expect(acquireLock(path, lockDeps())).toBe(true);
		expect(isLocked(path, lockDeps({ pid: 2 }))).toBe(true);
	});

	test("does not block the same pid", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(isLocked(path, lockDeps())).toBe(false);
	});

	test("does not block when the holder pid is dead", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(isLocked(path, lockDeps({ pid: 2, isAlive: () => false }))).toBe(false);
	});

	test("does not block a stale lock and takes it over", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		expect(isLocked(path, lockDeps({ pid: 2, now: () => 5000 }))).toBe(false);
		expect(acquireLock(path, lockDeps({ pid: 2, now: () => 5000 }))).toBe(true);
	});

	test("ignores a corrupt lockfile", () => {
		const path = newPath();
		writeFileSync(path, "{ broken", "utf-8");
		expect(isLocked(path, lockDeps())).toBe(false);
	});

	test("only the owner's release removes the lock", () => {
		const path = newPath();
		acquireLock(path, lockDeps());
		releaseLock(path, 2);
		expect(isLocked(path, lockDeps({ pid: 2 }))).toBe(true);
		// pid 2 did not own the lock, so the file is still there for its owner.
		releaseLock(path, 1);
		expect(isLocked(path, lockDeps({ pid: 2 }))).toBe(false);
		expect(acquireLock(path, lockDeps({ pid: 3 }))).toBe(true);
	});
});

describe("state", () => {
	function newPath(): string {
		return join(tempDir("wechat-state-"), "state.json");
	}

	test("round-trips the cursor and peers", () => {
		const path = newPath();
		writeState(path, { cursor: "c1", ownerId: "owner", peers: { p: { lastContextToken: "t", lastSeen: 7 } } });
		expect(readState(path)).toEqual({
			cursor: "c1",
			ownerId: "owner",
			peers: { p: { lastContextToken: "t", lastSeen: 7 } },
		});
	});

	test("returns empty state for a corrupt or missing file", () => {
		const broken = newPath();
		writeFileSync(broken, "{ broken", "utf-8");
		expect(readState(broken)).toEqual(emptyState());
		expect(readState(newPath())).toEqual(emptyState());
	});

	test("recordInbound keeps the previous context token when a new one is absent", () => {
		const state = emptyState();
		recordInbound(state, "p", "tok", 1);
		recordInbound(state, "p", undefined, 2);
		expect(state.peers.p).toEqual({ lastContextToken: "tok", lastSeen: 2 });
	});

	test("recordInbound keeps one entry for either id form", () => {
		const state = emptyState();
		recordInbound(state, "alice@im.wechat", "tok", 1);
		recordInbound(state, "alice", "tok2", 2);
		// One person, one entry: the first form seen is the stored key.
		expect(Object.keys(state.peers)).toEqual(["alice@im.wechat"]);
		expect(findPeer(state, "alice")).toEqual({ lastContextToken: "tok2", lastSeen: 2 });
		expect(findPeer(state, "ALICE@im.wechat")).toEqual({ lastContextToken: "tok2", lastSeen: 2 });
		expect(findPeer(state, "nobody")).toBeUndefined();
	});

	test("remembers a message id by normalized peer and expires it", () => {
		const state = emptyState();
		rememberMessage(state, "alice@im.wechat", 7, 1000);
		expect(seenMessage(state, "alice", 7)).toBe(true);
		expect(seenMessage(state, "ALICE", 7)).toBe(true);
		expect(seenMessage(state, "alice", 8)).toBe(false);
		expect(seenMessage(state, "bob", 7)).toBe(false);

		// One hour later the entry is stale; remembering a newer id prunes it.
		rememberMessage(state, "alice", 9, 1000 + SEEN_TTL_MS + 1);
		expect(seenMessage(state, "alice", 7)).toBe(false);
		expect(seenMessage(state, "alice", 9)).toBe(true);
	});

	test("caps the remembered ids", () => {
		const state = emptyState();
		for (let id = 0; id < SEEN_MAX + 10; id++) rememberMessage(state, "alice", id, 1000);
		expect(state.seen).toHaveLength(SEEN_MAX);
		expect(seenMessage(state, "alice", 0)).toBe(false);
		expect(seenMessage(state, "alice", SEEN_MAX + 9)).toBe(true);
	});

	test("round-trips seen ids and drops malformed entries", () => {
		const path = newPath();
		writeState(path, {
			cursor: "",
			peers: {},
			seen: [{ peer: "alice", id: 1, at: 5 }, { peer: "", id: 2, at: 5 }, { peer: "bob", id: "x", at: 5 } as never],
		});
		expect(readState(path).seen).toEqual([{ peer: "alice", id: 1, at: 5 }]);
	});

	test("findPeer prefers the freshest duplicate left by an older version", () => {
		const state = emptyState();
		state.peers.alice = { lastContextToken: "stale", lastSeen: 1 };
		state.peers["alice@im.wechat"] = { lastContextToken: "fresh", lastSeen: 2 };
		expect(findPeer(state, "alice")?.lastContextToken).toBe("fresh");

		recordInbound(state, "alice", "newer", 3);
		expect(state.peers["alice@im.wechat"]?.lastContextToken).toBe("newer");
		expect(state.peers.alice?.lastContextToken).toBe("stale");
	});
});

describe("timer map", () => {
	function scriptedArm() {
		const pending = new Map<number, () => void>();
		const armed: number[] = [];
		const cancelled: number[] = [];
		let next = 1;
		const arm: ArmTimer = (_ms, fn) => {
			const id = next++;
			pending.set(id, fn);
			armed.push(id);
			return () => {
				if (pending.delete(id)) cancelled.push(id);
			};
		};
		return {
			arm,
			armed,
			cancelled,
			last: () => armed.at(-1) ?? 0,
			fire(id: number) {
				const fn = pending.get(id);
				if (!fn) return;
				pending.delete(id);
				fn();
			},
		};
	}

	test("arms a timer and forgets the entry before the callback runs", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let pendingWhenFired: boolean | undefined;
		map.arm("alice", 1000, () => {
			pendingWhenFired = map.has("alice");
		});

		expect(map.has("alice")).toBe(true);
		timers.fire(timers.last());
		// A callback that re-arms itself (the typing keep-alive) relies on this.
		expect(pendingWhenFired).toBe(false);
		expect(map.has("alice")).toBe(false);
	});

	test("re-arming a key replaces the pending timer", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let first = 0;
		let second = 0;
		map.arm("alice", 10, () => {
			first += 1;
		});
		const firstId = timers.last();
		map.arm("alice", 10, () => {
			second += 1;
		});

		expect(timers.cancelled).toEqual([firstId]);
		timers.fire(firstId);
		timers.fire(timers.last());
		expect(first).toBe(0);
		expect(second).toBe(1);
	});

	test("stop cancels and forgets only its own key", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let fired = 0;
		map.arm("alice", 10, () => {
			fired += 1;
		});
		const alice = timers.last();
		map.arm("bob", 10, () => {
			fired += 1;
		});

		map.stop("alice");
		expect(map.has("alice")).toBe(false);
		expect(map.has("bob")).toBe(true);
		expect(timers.cancelled).toEqual([alice]);
		map.stop("alice");
		expect(timers.cancelled).toEqual([alice]);
		expect(map.keys()).toEqual(["bob"]);
	});

	test("clear cancels every pending timer", () => {
		const timers = scriptedArm();
		const map = createTimerMap(timers.arm);
		let fired = 0;
		for (const key of ["alice", "bob", "carol"]) {
			map.arm(key, 10, () => {
				fired += 1;
			});
		}
		const ids = [...timers.armed];

		map.clear();
		expect(timers.cancelled).toEqual(ids);
		expect(map.keys()).toEqual([]);
		for (const id of ids) timers.fire(id);
		expect(fired).toBe(0);
	});

	test("defaultSleep rejects at once for an already aborted signal", async () => {
		await expect(defaultSleep(60_000, AbortSignal.abort())).rejects.toThrow("aborted");
	});
});

describe("deliverer ordering", () => {
	test("serializes a reply and a prompt per peer", async () => {
		const order: string[] = [];
		let release: (() => void) | undefined;
		const client = {
			sendMessage: async (_account: unknown, args: { text: string }) => {
				if (args.text === "one") await new Promise<void>((resolve) => (release = resolve));
				order.push(args.text);
				return { ret: 0 };
			},
		} as unknown as WechatClient;
		const deliverer = createDeliverer({
			client: () => client,
			account: () => account,
			maxReplyChars: () => 1000,
			cdnBaseUrl: "",
			maxMediaBytes: 1024,
			notify: () => {},
			onExpired: () => {},
			forgetToken: () => {},
		});
		const first = deliverer.reply({ peer: "alice" }, "one");
		const second = deliverer.prompt({ peer: "alice" }, "two");
		await settle();
		expect(order).toEqual([]);
		release?.();
		await Promise.all([first, second]);
		expect(order).toEqual(["one", "two"]);
	});

	test("does not let one peer block another", async () => {
		const order: string[] = [];
		let release: (() => void) | undefined;
		const client = {
			sendMessage: async (_account: unknown, args: { to: string; text: string }) => {
				if (args.to === "slow") await new Promise<void>((resolve) => (release = resolve));
				order.push(args.text);
				return { ret: 0 };
			},
		} as unknown as WechatClient;
		const deliverer = createDeliverer({
			client: () => client,
			account: () => account,
			maxReplyChars: () => 1000,
			cdnBaseUrl: "",
			maxMediaBytes: 1024,
			notify: () => {},
			onExpired: () => {},
			forgetToken: () => {},
		});
		const slow = deliverer.reply({ peer: "slow" }, "one");
		const fast = deliverer.reply({ peer: "fast" }, "two");
		await settle();
		expect(order).toEqual(["two"]);
		release?.();
		await Promise.all([slow, fast]);
		expect(order).toEqual(["two", "one"]);
	});
});

describe("reply pipeline", () => {
	function pipelineHarness(options: { partChars?: number; quietMs?: number } = {}) {
		const parts: string[] = [];
		const timers: Array<{ fn: () => void }> = [];
		const pipeline = createReplyPipeline({
			sendPart: async (text) => {
				parts.push(text);
			},
			armTimer: (_ms, fn) => {
				// Only the latest quiet timer matters, like a real one-shot.
				const entry = { fn };
				timers.push(entry);
				return () => {
					const index = timers.indexOf(entry);
					if (index >= 0) timers.splice(index, 1);
				};
			},
			partChars: options.partChars,
			quietMs: options.quietMs,
		});
		return {
			pipeline,
			parts,
			/** Fire the pending quiet timer, as two silent seconds would. */
			quiet: () => {
				const pending = timers.splice(0);
				for (const timer of pending) timer.fn();
			},
		};
	}

	test("sends each paragraph as it completes, then the remainder", async () => {
		const { pipeline, parts } = pipelineHarness();
		pipeline.push("first para\n\n");
		await settle();
		pipeline.push("second para");
		expect(parts).toEqual(["first para"]);
		await pipeline.finish();
		expect(parts).toEqual(["first para", "second para"]);
		expect(pipeline.sent()).toBe("first parasecond para");
	});

	test("flushes after a quiet period inside a paragraph", async () => {
		const { pipeline, parts, quiet } = pipelineHarness();
		pipeline.push("half a thought");
		expect(parts).toEqual([]);
		quiet();
		await pipeline.finish();
		expect(parts).toEqual(["half a thought"]);
	});

	test("caps a part that runs long and breaks on a word boundary", async () => {
		const { pipeline, parts } = pipelineHarness({ partChars: 20 });
		pipeline.push("alpha beta gamma delta epsilon");
		await settle();
		// The first part is cut at a space, not mid-word.
		expect(parts[0]).toBe("alpha beta gamma");
		await pipeline.finish();
		expect(parts.join(" ")).toBe("alpha beta gamma delta epsilon");
	});

	test("never sends an empty or whitespace-only part", async () => {
		const { pipeline, parts } = pipelineHarness();
		pipeline.push("\n\n   \n\n");
		await pipeline.finish();
		expect(parts).toEqual([]);
		expect(pipeline.sent()).toBe("");
	});

	test("drop discards the unsent remainder but keeps what went out", async () => {
		const { pipeline, parts } = pipelineHarness();
		pipeline.push("sent\n\n");
		await settle();
		pipeline.push("never sent");
		pipeline.drop();
		await pipeline.finish();
		expect(parts).toEqual(["sent"]);
		expect(pipeline.text()).toBe("sent\n\nnever sent");
		expect(pipeline.sent()).toBe("sent");
	});

	test("sends parts strictly in order even when a send is slow", async () => {
		const parts: string[] = [];
		let release: (() => void) | undefined;
		const pipeline = createReplyPipeline({
			sendPart: async (text) => {
				if (text === "one") await new Promise<void>((resolve) => (release = resolve));
				parts.push(text);
			},
			armTimer: () => () => {},
		});
		pipeline.push("one\n\n");
		pipeline.push("two\n\n");
		pipeline.push("three");
		const finished = pipeline.finish();
		await settle();
		// The second send waits for the first, so nothing overtakes it.
		expect(parts).toEqual([]);
		release?.();
		await finished;
		expect(parts).toEqual(["one", "two", "three"]);
	});

	test("a rejected part does not stop the later parts", async () => {
		const parts: string[] = [];
		const pipeline = createReplyPipeline({
			sendPart: async (text) => {
				parts.push(text);
				if (text === "one") throw new Error("refused");
			},
			armTimer: () => () => {},
		});
		pipeline.push("one\n\n");
		pipeline.push("two");
		await pipeline.finish();
		expect(parts).toEqual(["one", "two"]);
		// `sent()` is "the turn produced text", not "the transport accepted it";
		// the bridge reports the rejection.
		expect(pipeline.sent()).toBe("onetwo");
	});
});

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
			dispose: () => {
				disposals += 1;
			},
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

		opened.dispose();
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
				dispose: () => session.dispose(),
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
			idleTimeoutMs?: number;
			concurrency?: number;
			/** Whether the transport accepts a part; defaults to yes. */
			accept?: (text: string) => boolean;
			/** How a send ends: accepted, thrown, or held until its signal aborts. */
			send?: "accept" | "throw" | "untilAborted";
		} = {},
	) {
		const sent: Array<{ peer: string; text: string }> = [];
		const notices: string[] = [];
		const opened: Array<{ peer: string; fresh: boolean }> = [];
		const sessions: ReturnType<typeof workerSession>[] = [];
		const timers: Array<{ ms: number; fn: () => void }> = [];
		const worker = createPeerWorker({
			openSession: async (peer, sessionOptions) => {
				opened.push({ peer, fresh: sessionOptions.fresh });
				const fake = workerSession(options);
				sessions.push(fake);
				return fake.peerSession;
			},
			send: async (target, text, sendOptions) => {
				sent.push({ peer: target.peer, text });
				if (options.send === "throw") throw new Error("transport down");
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
		return { worker, sent, notices, opened, sessions, timers };
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
			dispose: () => disposed.push(1),
		} as never);
		await settle();
		await settle();
		// The late session is disposed instead of leaking, and the turn reports failure.
		expect(disposed).toHaveLength(1);
	});

	test("runs one turn at a time across peers, then hands the slot on", async () => {
		const { worker, sessions } = workerHarness({ holdFirst: true });
		worker.enqueue(peerItem("alice task", "alice@im.wechat"));
		worker.enqueue(peerItem("bob task", "bob@im.wechat"));
		await settle();
		// One turn at a time by default, so a forwarded dialog has one owner.
		expect(worker.current()?.text).toBe("alice task");
		expect(sessions).toHaveLength(1);

		await sessions[0]?.session.abort();
		await settle();
		await settle();
		expect(sessions[1]?.prompts).toEqual(["bob task"]);
		expect(worker.current()?.text).toBe("bob task");
	});

	test("runs peers in parallel when the concurrency allows it", async () => {
		const { worker, sessions } = workerHarness({ holdFirst: true, concurrency: 2 });
		worker.enqueue(peerItem("alice task", "alice@im.wechat"));
		worker.enqueue(peerItem("bob task", "bob@im.wechat"));
		await settle();
		expect(sessions).toHaveLength(2);
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
			account: () => robot,
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
			onMessages: (list) => messages.push(...list),
			refreshLock: () => {
				refreshes += 1;
			},
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
		expect(sent.refreshes()).toBe(1);
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
			account: () => robot,
			holdMs: () => undefined,
			cursor: () => "c0",
			setCursor: () => {},
			saveState: () => {},
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			notify: (message) => notices.push(message),
			onExpired: () => {},
			onMessages: (list) => messages.push(...list),
			refreshLock: () => {},
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
		const statuses = new Map<string, PeerState["status"]>();
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
			account: () => robot,
			signal: () => undefined,
			statusOf: (peer) => statuses.get(peer) ?? "idle",
			languageOf: () => "en",
			send: async (peer, _contextToken, text) => {
				sent.push({ peer, text });
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
			status: (peer: string, state: PeerState["status"]) => statuses.set(peer, state),
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
		harness.presence.keepTyping("alice", undefined);
		await settle();
		expect(harness.typing[0]).toEqual({ ilinkUserId: "alice", typing: true });
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
		harness.presence.keepTyping("alice", undefined);
		await settle();
		expect(harness.typing).toEqual([]);
	});

	test("acknowledges a waiting peer once after the delay", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck({ peer: "alice" });
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toEqual([{ peer: "alice", text: "Queued — I'll answer next." }]);

		// A second message inside the repeat window is not acknowledged again.
		harness.presence.armAck({ peer: "alice" });
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toHaveLength(1);
	});

	test("acknowledges a message queued behind a running turn", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.armAck({ peer: "alice" });
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent.map((entry) => entry.text)).toEqual(["Queued — I'll answer next."]);
	});

	test("cancels a pending acknowledgement when the turn starts", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck({ peer: "alice" });
		harness.presence.cancelAck("alice");
		harness.timers.fire(4000);
		await settle();
		expect(harness.sent).toEqual([]);
	});

	test("says busy once, a minute after the acknowledgement", async () => {
		const harness = presenceHarness();
		harness.status("alice", "queued");
		harness.presence.armAck({ peer: "alice" });
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
		harness.presence.armSlowNotice("alice", undefined);
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
		harness.presence.armSlowNotice("alice", undefined);
		harness.timers.fire(30_000);
		await settle();
		// The prompt nudges for itself; a second bubble would read as noise.
		expect(harness.sent).toEqual([]);
	});

	test("typingOff clears the indicator and reset drops every timer", async () => {
		const harness = presenceHarness();
		harness.status("alice", "running");
		harness.presence.keepTyping("alice", undefined);
		await settle();
		await harness.presence.typingOff("alice");
		expect(harness.typing.at(-1)).toEqual({ ilinkUserId: "alice", typing: false });

		harness.presence.armSlowNotice("alice", undefined);
		harness.presence.reset();
		expect(harness.timers.count()).toBe(0);
	});
});
