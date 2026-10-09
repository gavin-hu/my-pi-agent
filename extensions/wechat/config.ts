/**
 * Loading and normalizing `wechat.json`.
 *
 * The effective config is `<agentDir>/wechat.json` overridden by
 * `<cwd>/.pi/wechat.json`. Unknown keys are ignored and every value is clamped
 * or cleaned. Connection state is not stored here; it is controlled at runtime
 * by `/wechat open` and `/wechat close`.
 */

import { clampInteger, cleanString, loadConfigFile } from "../../lib/config.ts";

export interface WechatConfig {
	/** Extra peers allowed to drive the agent; the owner is always allowed. */
	allowedPeers: string[];
	/** Fallback long-poll timeout when the server omits one. */
	pollTimeoutMs: number;
	/** Replies longer than this are split into multiple messages. */
	maxReplyChars: number;
	/** Observability identifier sent as `base_info.bot_agent`. */
	botAgent: string;
	/** Plugin version sent as `base_info.channel_version`. */
	channelVersion: string;
}

export const DEFAULT_CONFIG: WechatConfig = {
	allowedPeers: [],
	pollTimeoutMs: 35000,
	maxReplyChars: 4000,
	botAgent: "pi-wechat",
	channelVersion: "0.1.0",
};

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
	if (raw.pollTimeoutMs !== undefined) {
		config.pollTimeoutMs = clampInteger(raw.pollTimeoutMs, base.pollTimeoutMs, 1000, 120000);
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
	return config;
}

/** The effective config for `cwd`. */
export function loadWechatConfig(cwd: string): WechatConfig {
	return loadConfigFile(cwd, "wechat.json", DEFAULT_CONFIG, normalizeConfig);
}
