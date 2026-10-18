/**
 * Loading and normalizing the `wechat` section of the shared `bytefly.json`.
 *
 * The effective config is the global section overridden by the project
 * section. Unknown keys are ignored and every value is clamped or cleaned.
 * Connection state is not stored here; the stored account controls the bridge
 * lifecycle.
 */

import { clampInteger, cleanString, loadConfigSection } from "../../lib/config.ts";

/** Per-peer overrides, keyed by id or label (both forms match). */
export interface WechatPeerConfig {
	/** Active tool names; absent keeps the full set, an empty list disables tools. */
	tools?: string[];
}

export interface WechatConfig {
	/** Extra peers allowed to drive the agent; the owner is always allowed. */
	allowedPeers: string[];
	/** Per-peer overrides; an id matches with or without the suffix. */
	peers: Record<string, WechatPeerConfig>;
	/** Turns allowed per peer in a rolling hour; 0 disables the cap. */
	maxTurnsPerHour: number;
	/** Replies longer than this are split into multiple messages. */
	maxReplyChars: number;
	/** Observability identifier sent as `base_info.bot_agent`. */
	botAgent: string;
	/** Plugin version sent as `base_info.channel_version`. */
	channelVersion: string;
	/** Base URL for CDN media downloads and uploads. */
	cdnBaseUrl: string;
	/** Inbound media larger than this is skipped. */
	maxMediaBytes: number;
	/** Inbound text longer than this is truncated before it reaches the model. */
	maxInboundChars: number;
	/** Send a typing indicator while an inbound turn is being generated. */
	typingIndicator: boolean;
	/** Route interactive dialogs raised during a WeChat turn back to WeChat. */
	remotePrompts: boolean;
	/**
	 * Ask the server for this long-poll hold, in milliseconds. Unset means "use the
	 * server's own", which is what every release before this option did; the
	 * field is a protocol experiment, so it is opt-in.
	 */
	pollHoldMs?: number;
}

export const DEFAULT_CONFIG: WechatConfig = {
	allowedPeers: [],
	peers: {},
	maxTurnsPerHour: 0,
	maxReplyChars: 4000,
	botAgent: "pi-wechat",
	channelVersion: "0.1.0",
	cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
	maxMediaBytes: 20 * 1024 * 1024,
	maxInboundChars: 8000,
	typingIndicator: true,
	remotePrompts: true,
};

/** A cleaned, slash-free base URL. */
function toBaseUrl(value: unknown, fallback: string): string {
	return cleanString(value, fallback).replace(/\/+$/, "");
}

/** Per-peer overrides; malformed entries and ids are dropped, tools are cleaned. */
function normalizePeers(value: unknown): Record<string, WechatPeerConfig> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const peers: Record<string, WechatPeerConfig> = {};
	for (const [rawId, raw] of Object.entries(value as Record<string, unknown>)) {
		const id = rawId.trim();
		if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const tools = (raw as Record<string, unknown>).tools;
		if (tools === undefined) {
			peers[id] = {};
			continue;
		}
		if (!Array.isArray(tools)) continue;
		peers[id] = {
			tools: tools
				.filter((name): name is string => typeof name === "string")
				.map((name) => name.trim())
				.filter((name) => name !== "")
				.slice(0, 200),
		};
	}
	return Object.keys(peers).length > 0 ? peers : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Validate/clamp a raw config object over a running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: WechatConfig): WechatConfig {
	const config: WechatConfig = { ...base };
	if (!raw) return config;
	const peers = toStringArray(raw.allowedPeers);
	if (peers) config.allowedPeers = peers;
	const peerConfigs = normalizePeers(raw.peers);
	if (peerConfigs) config.peers = peerConfigs;
	if (raw.maxTurnsPerHour !== undefined) {
		config.maxTurnsPerHour = clampInteger(raw.maxTurnsPerHour, base.maxTurnsPerHour, 0, 500);
	}
	if (raw.maxReplyChars !== undefined) {
		config.maxReplyChars = clampInteger(raw.maxReplyChars, base.maxReplyChars, 1, 20000);
	}
	if (raw.botAgent !== undefined) {
		config.botAgent = cleanString(raw.botAgent, base.botAgent).slice(0, 256);
	}
	if (raw.channelVersion !== undefined) {
		config.channelVersion = cleanString(raw.channelVersion, base.channelVersion);
	}
	if (raw.cdnBaseUrl !== undefined) {
		config.cdnBaseUrl = toBaseUrl(raw.cdnBaseUrl, base.cdnBaseUrl);
	}
	if (raw.maxMediaBytes !== undefined) {
		config.maxMediaBytes = clampInteger(raw.maxMediaBytes, base.maxMediaBytes, 1024, 100 * 1024 * 1024);
	}
	if (raw.maxInboundChars !== undefined) {
		config.maxInboundChars = clampInteger(raw.maxInboundChars, base.maxInboundChars, 1000, 100_000);
	}
	if (typeof raw.typingIndicator === "boolean") {
		config.typingIndicator = raw.typingIndicator;
	}
	if (typeof raw.remotePrompts === "boolean") {
		config.remotePrompts = raw.remotePrompts;
	}
	if (raw.pollHoldMs !== undefined) {
		const hold = clampInteger(raw.pollHoldMs, 0, 0, 120_000);
		// `0` clears an inherited value; anything below a second is not a poll.
		config.pollHoldMs = hold >= 1000 ? hold : undefined;
	}
	return config;
}

/** The effective config from the shared `wechat` section. */
export function loadWechatConfig(cwd: string): WechatConfig {
	return loadConfigSection(cwd, "wechat", DEFAULT_CONFIG, normalizeConfig);
}
