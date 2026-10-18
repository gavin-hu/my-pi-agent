/**
 * One Pi session per WeChat peer.
 *
 * The live terminal session must not be the WeChat agent: sharing it is what
 * forced the idle gate (a WeChat turn could only start when the terminal was
 * idle), the `lastText` reply capture, and one conversation for two audiences.
 * A peer session is an ordinary `AgentSession` created through the SDK, with its
 * own history, model context, and tools, so a WeChat message can start a turn
 * immediately and the terminal transcript never sees it.
 *
 * Three contract points live here:
 *
 * - The bridge's own extension is filtered out of the peer's resource loader.
 *   Loading it inside a peer session would start a second poller for the same
 *   account, which the poller lock then rejects — and the ordering would be
 *   arbitrary.
 * - The peer's dialogs route to the phone. `bindExtensions` is given this peer's
 *   `ExtensionUIContext`, so `ask_user_question` and plan approval reach the
 *   sender instead of a terminal that is not watching.
 * - History is one session directory per peer under the WeChat state dir, so a
 *   restart resumes the conversation instead of forgetting it.
 */

import {
	type AgentSession,
	createAgentSession,
	type CreateAgentSessionOptions,
	DefaultResourceLoader,
	type ExtensionError,
	type ExtensionUIContext,
	type LoadExtensionsResult,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { peerKey } from "./format.ts";

/** The SDK pieces a peer session needs; injected so tests never load resources. */
export interface PeerSessionSeams {
	create?: typeof createAgentSession;
	/** Build the resource loader; overridden in tests to assert the override. */
	loader?: (cwd: string, agentDir: string) => DefaultResourceLoader;
}

export interface PeerSessionOptions {
	cwd: string;
	agentDir: string;
	/** Root holding one session directory per peer. */
	sessionsDir: string;
	/** Model and thinking level inherited from the host session. */
	model?: CreateAgentSessionOptions["model"];
	thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
	/** The dialog surface this peer's extensions get: WeChat, not the terminal. */
	uiContext: ExtensionUIContext;
	/** An extension error, reported on the terminal. */
	onError?: (message: string) => void;
	/** Start an empty conversation instead of resuming this peer's last one. */
	fresh?: boolean;
	seams?: PeerSessionSeams;
}

/** One peer's live session. */
export interface PeerSession {
	session: AgentSession;
	/** Drop the session and its event listeners. History is already on disk. */
	dispose(): void;
}

/** The session directory of one peer; one conversation per peer. */
export function peerSessionDir(sessionsDir: string, peer: string): string {
	return join(sessionsDir, peerKey(peer) || "unknown");
}

/**
 * Whether a loaded extension is this bridge. It must never load inside a peer
 * session: its poll loop is per account, not per conversation.
 */
export function isWechatExtensionPath(resolvedPath: string): boolean {
	return /(^|\/)wechat\/index\.(?:[cm]?tsx?|jsx?)$/.test(resolvedPath.replace(/\\/g, "/"));
}

/** Drop this bridge from a loaded extension set, keeping everything else. */
export function withoutWechatExtensions(base: LoadExtensionsResult): LoadExtensionsResult {
	const extensions = base.extensions.filter((extension) => !isWechatExtensionPath(extension.resolvedPath));
	return extensions.length === base.extensions.length ? base : { ...base, extensions };
}

/**
 * Add every directly-exposed tool to the session's active set.
 *
 * An SDK session starts with the settings' default selection, which is the
 * built-in tools; tools that extensions register are present but not declared to
 * the model. A peer should get the same toolset the terminal session has, so the
 * directly-exposed ones (`direct`, the "active on registration" default) are
 * activated. `codemode`/`deferred`/`model-only` tools stay as the session left
 * them, and anything the settings exclude never reaches `getAllTools()`.
 */
export function activateDirectTools(session: {
	getActiveToolNames(): string[];
	getAllTools(): Array<{ name: string; exposure: string }>;
	setActiveToolsByName(names: string[]): void;
}): string[] {
	const active = new Set(session.getActiveToolNames());
	for (const tool of session.getAllTools()) {
		if (tool.exposure === "direct") active.add(tool.name);
	}
	const names = [...active];
	session.setActiveToolsByName(names);
	return names;
}

function describeError(error: ExtensionError): string {
	const where = error.extensionPath.split("/").slice(-2).join("/");
	return `${where} (${error.event}): ${error.error}`;
}

/**
 * Open, or resume, the session for one peer.
 *
 * The returned session is not subscribed to anything: the caller drives it with
 * `prompt`/`abort` and reads its events. `dispose()` must be called when the peer
 * goes idle for long enough, so N peers do not keep N contexts alive.
 */
export async function openPeerSession(peer: string, options: PeerSessionOptions): Promise<PeerSession> {
	const create = options.seams?.create ?? createAgentSession;
	const buildLoader =
		options.seams?.loader ??
		((cwd: string, agentDir: string) =>
			// Standard discovery (the package's other extensions, skills, context
			// files) with this bridge removed, so the peer keeps the real toolset
			// without a second poller.
			new DefaultResourceLoader({ cwd, agentDir, extensionsOverride: withoutWechatExtensions }));

	const sessionManager = options.fresh
		? SessionManager.create(options.cwd, peerSessionDir(options.sessionsDir, peer))
		: SessionManager.continueRecent(options.cwd, peerSessionDir(options.sessionsDir, peer));
	// A freshly built loader has discovered nothing yet; the session would then be
	// created with no extensions and only the built-in tools.
	const resourceLoader = buildLoader(options.cwd, options.agentDir);
	await resourceLoader.reload();
	const { session } = await create({
		cwd: options.cwd,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		sessionManager,
		resourceLoader,
	});

	await session.bindExtensions({
		// The peer answers their own dialogs on the phone; `rpc` is the mode that
		// means "dialogs are forwarded, no custom components" rather than `tui`.
		mode: "rpc",
		uiContext: options.uiContext,
		onError: (error) => options.onError?.(describeError(error)),
	});
	// Extensions register their tools during load; the SDK session only declares
	// the settings' default selection, so the peer would otherwise see read/bash/
	// edit/write and none of the package's tools.
	activateDirectTools(session);

	return {
		session,
		dispose: () => session.dispose(),
	};
}
