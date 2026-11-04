/**
 * wechat — a bridge between Pi and WeChat, one session per admitted peer.
 *
 * Each peer's message becomes a turn in that peer's own Pi session (its own
 * history, model context, and tools), and that session's answer is sent back.
 * The terminal session is never injected into, so the two conversations cannot
 * mix. One account is bound to one Pi session and the bridge is started and
 * stopped by hand on it: `/wechat start` records the binding on the session
 * branch and opens the poller, `/wechat stop` closes it and records the stop, and
 * a stored account alone starts nothing. `/wechat` opens the control screen. See
 * `README.md`.
 *
 * Load with:  pi --extension ./extensions/wechat
 */

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { isExtensionEnabled } from "../../lib/env.ts";
import { lazy } from "../../lib/lazy.ts";
import { isPidAlive } from "../../lib/spawn.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import { paint } from "../../lib/tui/tokens.ts";
import type { Bridge, BridgeState } from "./bridge.ts";
import type { WechatClient, WechatClientOptions } from "./transport/client.ts";
import { registerCommands, type CommandDeps, type StartOutcome } from "./commands/commands.ts";
import { messageOf } from "../../lib/errors.ts";
import { loadWechatConfig, type WechatConfig } from "./config.ts";
import {
	accountKey,
	clearCredentials,
	migrateCredentials,
	saveAccount,
	storedAccount,
	wechatDir,
} from "./state/credentials.ts";
import { loadBinding, persistBinding, type WechatBinding } from "./state/binding.ts";
import type { PeerSession, PeerSessionOptions } from "./peer/peer-session.ts";
import { peerKey } from "./text/format.ts";
import { registerTools } from "./tools.ts";

/**
 * The chip text for a bridge state: a success chip while connected, and an error
 * chip that persists after a session expiry until the user reconnects or stops
 * the bridge. `stopped` publishes nothing.
 */
export function wechatChip(theme: Theme, state: BridgeState): string | undefined {
	switch (state) {
		case "running":
			return paint(theme, "ok", `${GLYPHS.wechat} wechat`);
		case "expired":
			return paint(theme, "bad", `${GLYPHS.wechat} wechat expired`);
		case "stopped":
			return undefined;
	}
}

/** Test seams: production uses the fetched HTTP transport, the real timers, and real sessions. */
export interface WechatDeps {
	/** Build the iLink client; overridden in tests so no request leaves the process. */
	createClient?: (options: WechatClientOptions) => WechatClient;
	/** Injected sleep; overridden in tests so the poll loop never waits on a real timer. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	/**
	 * Build a peer's session. Overridden in tests, which must not load extensions or
	 * call a model; production opens a real SDK session per peer.
	 */
	openSession?: (peer: string, options: PeerSessionOptions) => Promise<PeerSession>;
	/** The bridge module; overridden in tests so a load can be counted. */
	loadBridge?: () => Promise<typeof import("./bridge.ts")>;
}

export default function wechat(pi: ExtensionAPI, deps: WechatDeps = {}): void {
	if (!isExtensionEnabled("wechat")) return;

	/** The bridge and the transport, loaded on the first start, never at registration. */
	const bridgeModule = lazy(deps.loadBridge ?? (() => import("./bridge.ts")));
	const clientModule = lazy(() => import("./transport/client.ts"));

	let bridge: Bridge | undefined;
	/** A build in flight, so a command that races a start joins it instead of loading twice. */
	let building: Promise<Bridge> | undefined;
	/**
	 * The account key this runtime opened the bridge for, so a branch whose binding
	 * moved can be reconciled with what is actually polling.
	 */
	let boundTo: string | undefined;
	/**
	 * Bumped by every start and every stop, so a start that a stop overtook while it
	 * was building cannot bind the branch after the stop wrote it.
	 */
	let epoch = 0;
	let ctxRef: ExtensionContext | undefined;

	const lockDeps = () => ({
		now: () => Date.now(),
		pid: process.pid,
		isAlive: isPidAlive,
	});

	/** The account the session branch binds, or undefined when nothing is bound. */
	const bindingOf = (ctx: ExtensionContext): string | undefined =>
		loadBinding(ctx.sessionManager.getBranch())?.account ?? undefined;

	/** Record a binding on the session branch; this file is the only writer. */
	const persist = (binding: WechatBinding): void => {
		persistBinding((customType, data) => pi.appendEntry(customType, data), binding);
	};

	/** One iLink client over the fetched transport, from an already-loaded module. */
	const clientOf = (
		module: typeof import("./transport/client.ts"),
		config: WechatConfig,
		account?: { baseUrl: string },
	): WechatClient =>
		(deps.createClient ?? ((options: WechatClientOptions) => new module.WechatClient(options)))({
			http: module.createFetchRunner(),
			channelVersion: config.channelVersion,
			botAgent: config.botAgent,
			cdnBaseUrl: config.cdnBaseUrl,
			...(account === undefined ? {} : { baseUrl: account.baseUrl }),
		});

	const build = async (ctx: ExtensionContext): Promise<Bridge> => {
		ctxRef = ctx;
		const config = loadWechatConfig(ctx.cwd);
		const peerTools = new Map(Object.entries(config.peers).map(([id, peer]) => [peerKey(id), peer.tools] as const));
		// Everything a live bridge composes loads here, so a session with no account
		// never evaluates the bridge, the peer worker, the transport or the lock.
		const [{ createBridge }, client, { openPeerSession }, { createPeerUIContext }] = await Promise.all([
			bridgeModule.get(),
			clientModule.get(),
			import("./peer/peer-session.ts"),
			import("./dialog/remote-ui.ts"),
		]);
		const { acquireLock, lockPath, readLock, refreshLock, releaseLock } = await import("./state/lock.ts");
		const { readState, statePath, writeState } = await import("./state/state.ts");
		const { SLASH_COMMANDS } = await import("./commands/slash.ts");
		const { readPeerHistory } = await import("./commands/history.ts");
		return createBridge({
			config,
			now: () => Date.now(),
			// Each peer gets its own session under the WeChat state dir, with the host's
			// model and thinking level, and its dialogs bound to that peer.
			openSession: (peer, options) =>
				(deps.openSession ?? openPeerSession)(peer, {
					cwd: ctxRef?.cwd ?? process.cwd(),
					agentDir: getAgentDir(),
					sessionsDir: join(wechatDir(), "sessions"),
					model: ctxRef?.model,
					thinkingLevel: ctxRef?.thinkingLevel,
					// The peer's dialogs go to that peer only when `remotePrompts` is on;
					// the terminal's own UI is never adapted, so a local turn keeps its dialogs.
					uiContext: createPeerUIContext(options.channel, (message) => ctxRef?.ui.notify(message), {
						prompts: config.remotePrompts,
					}),
					onError: (message) => ctxRef?.ui.notify(`WeChat peer session: ${message}`, "warning"),
					onWarning: (message) => ctxRef?.ui.notify(message, "warning"),
					toolAllowlist: peerTools.get(peerKey(peer)),
					fresh: options.fresh,
				}),
			mediaDir: () => join(wechatDir(), "media"),
			readHistory: (peer, count) =>
				readPeerHistory(ctxRef?.cwd ?? process.cwd(), join(wechatDir(), "sessions"), peer, count),
			slashCommands: SLASH_COMMANDS,
			loadAccount: () => storedAccount(),
			loadState: () => readState(statePath()),
			saveState: (state) => writeState(statePath(), state),
			createClient: (account) => clientOf(client, config, account),
			sleep: deps.sleep,
			acquireLock: () => acquireLock(lockPath(), lockDeps()),
			refreshLock: () => refreshLock(lockPath(), lockDeps()),
			releaseLock: () => releaseLock(lockPath(), process.pid),
			loadLock: () => readLock(lockPath()),
			notify: (message, kind) => {
				ctxRef?.ui.notify(message, kind);
			},
			onStateChange: (state) => {
				const ui = ctxRef?.ui;
				if (!ui) return;
				try {
					ui.setStatus(STATUS_KEYS.wechat, wechatChip(ui.theme, state));
				} catch {
					// The chip is best-effort; a headless or themeless UI must not break open/close.
				}
			},
		});
	};

	/** Build the bridge once, sharing the load with a command that asks while it is in flight. */
	const ensure = (ctx: ExtensionContext): Promise<Bridge> => {
		building ??= build(ctx).then(
			(built) => {
				bridge = built;
				return built;
			},
			(error: unknown) => {
				// A failed build is not remembered, so the next command can retry.
				building = undefined;
				throw error;
			},
		);
		return building;
	};

	/**
	 * Wait for a start this runtime already began: a hand start's build, or the
	 * reconcile a frame ran. A reader that arrives mid-start sees the bridge that
	 * start opens rather than reporting one that is not there yet.
	 */
	const settle = async (): Promise<void> => {
		await starting?.catch(() => undefined);
		await building?.catch(() => undefined);
	};

	/** Drop the bridge handle, so the next start builds one from the stored account. */
	const forget = (): void => {
		bridge = undefined;
		building = undefined;
		boundTo = undefined;
	};

	/** Open the poller for an account the session binds, replacing what this runtime ran. */
	const open = async (ctx: ExtensionContext, key: string): Promise<void> => {
		const built = bridge ?? (await ensure(ctx));
		built.open();
		boundTo = key;
	};

	/**
	 * Reconcile the branch's binding with the running bridge.
	 *
	 * A session that bound an account starts it again after `/resume` or a tree
	 * jump, and a branch whose binding was stopped — or never made — closes what
	 * this runtime opened. The bound account must still be the stored one, because
	 * a binding names an account rather than a token.
	 */
	const applyBinding = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
		const wanted = bindingOf(ctx);
		if (wanted === boundTo) return;
		if (boundTo !== undefined) {
			// One runtime runs one poller, and a tree jump can land on another binding.
			const running = bridge;
			forget();
			await running?.close();
		}
		if (wanted === undefined) return;
		const stored = storedAccount();
		if (!stored || accountKey(stored) !== wanted) {
			ctx.ui.notify(
				"WeChat is bound to an account that is not stored. Run /wechat login, then /wechat start.",
				"warning",
			);
			return;
		}
		try {
			await open(ctx, wanted);
		} catch (error) {
			ctx.ui.notify(`WeChat did not connect: ${messageOf(error)}`, "warning");
		}
	};

	/**
	 * The start a session began, so everything that needs the bridge can join it.
	 *
	 * Pi awaits every `session_start` handler, and opening a bridge is a module graph
	 * plus a login over the network, so the start is handed back to Pi at once and the
	 * promise is kept here. One promise, not one per call: the RPC double
	 * `session_start`, a command, and a tool that all arrive mid-build must see the
	 * same start, or two of them could open two pollers.
	 */
	let starting: Promise<void> | undefined;
	const start = (ctx: ExtensionContext): Promise<void> => {
		starting ??= applyBinding(ctx)
			.catch(() => {
				// The start reports its own failures; a rejected promise nothing awaits must not
				// become an unhandled rejection that takes the session down.
			})
			.finally(() => {
				starting = undefined;
			});
		return starting;
	};

	/**
	 * Start the bridge by hand on this session, and bind it.
	 *
	 * A login that replaced the stored account leaves a running poller holding the
	 * previous token, so a start whose account differs replaces it. The binding is
	 * recorded only once the poller is up: a lock another session holds is a
	 * refused start, not a bound session that is not running.
	 */
	const startBridge = async (ctx: ExtensionContext): Promise<StartOutcome> => {
		const account = storedAccount();
		if (!account) throw new Error("Not logged in. Run /wechat login first.");
		const key = accountKey(account);
		if (bridge?.status().state === "running" && boundTo === key) return "already-running";
		const mine = ++epoch;
		if (bridge !== undefined) {
			const running = bridge;
			forget();
			await running.shutdown();
		}
		await open(ctx, key);
		// A stop that landed while this start was building owns the session now: close
		// what opened and leave the branch's stop as the last word.
		if (epoch !== mine) {
			const overtaken = bridge;
			forget();
			await overtaken?.shutdown();
			return "superseded";
		}
		persist({ account: key });
		return "started";
	};

	/** Stop the bridge by hand on this session, and record the stop the branch keeps. */
	const stopBridge = async (): Promise<boolean> => {
		// A start may still be building, and closing before it lands would leave the
		// poller that lands afterwards running behind a session that stopped it.
		epoch += 1;
		await settle();
		const wasRunning = bridge !== undefined && bridge.status().state !== "stopped";
		await bridge?.shutdown();
		forget();
		// An explicit stop is recorded even on a session that never started one: it is
		// this session's answer, and a resume must not open what a person closed.
		persist({ account: null });
		return wasRunning;
	};

	const commandDeps: CommandDeps = {
		getBridge: () => bridge,
		startBridge,
		stopBridge,
		loadConfig: (cwd) => loadWechatConfig(cwd),
		createLoginClient: async (cwd) => {
			const config = loadWechatConfig(cwd);
			return clientOf(await clientModule.get(), config);
		},
		saveAccount,
		storedAccount,
		readHistory: async (peer, count) => {
			const { readPeerHistory } = await import("./commands/history.ts");
			return readPeerHistory(ctxRef?.cwd ?? process.cwd(), join(wechatDir(), "sessions"), peer, count);
		},
		logout: async () => {
			epoch += 1;
			await settle();
			clearCredentials();
			// The account the branch bound is gone, so the binding goes with it: a
			// resume would otherwise open a bridge with nothing to log in as.
			persist({ account: null });
			forget();
		},
		now: () => Date.now(),
	};

	registerCommands(pi, commandDeps);
	// A tool call is the other reader that can arrive first: it joins a start the
	// session already began, and never begins one — the bridge is opened by hand.
	registerTools(pi, {
		getBridge: async () => {
			// A tool joins a start that is already happening — the frame's reconcile or a
			// hand start's build — and never begins one: the bridge is opened by hand.
			await settle();
			return bridge;
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
		// One account per file: a file an older version wrote as a map is rewritten
		// once, so the accounts it listed beside the active one stop existing.
		try {
			migrateCredentials();
		} catch {
			// The rewrite is housekeeping; a read of a legacy file still works.
		}
		// A session that bound an account opens it again here, which is what makes
		// `/resume`, `/reload`, and the RPC double start land on one poller; a
		// session with no binding — a fresh `/new`, or one that never started it —
		// opens nothing.
		void start(ctx);
	});
	// A tree jump lands on another branch, whose binding may be a different account
	// or none: the running poller is reconciled with what the branch now says.
	pi.on("session_tree", (_event, ctx) => {
		ctxRef = ctx;
		void start(ctx);
	});
	pi.on("session_shutdown", async () => {
		// Shutdown is emitted before the host resets the UI, so the chip is still ours to clear.
		ctxRef?.ui.setStatus(STATUS_KEYS.wechat, undefined);
		try {
			// A session can end while its deferred start is still opening: waiting for it here
			// is what keeps a bridge that lands afterwards from polling a dead runtime.
			await starting;
			await bridge?.shutdown();
		} finally {
			// The binding stays on the branch, so a resume reopens what a shutdown
			// closed; only `/wechat stop` and `/wechat logout` unbind.
			forget();
			starting = undefined;
			ctxRef = undefined;
		}
	});
}
