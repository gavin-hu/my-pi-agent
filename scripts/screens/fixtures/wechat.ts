/**
 * The WeChat status screen: a stored account, an open bridge serving three peers,
 * one of them mid-turn, and the view built from the two.
 */

import type { BridgeStatus } from "../../../extensions/wechat/bridge.ts";
import { statusView } from "../../../extensions/wechat/text/status.ts";
import type { BotCredentials } from "../../../extensions/wechat/types.ts";
import { now } from "./shared.ts";

/** A stored account and an open bridge serving three peers, one of them mid-turn. */
export const WECHAT_ACCOUNT: BotCredentials = {
	botToken: "token",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "bot-id",
	baseUrl: "https://ilink.example.invalid",
	botAgent: "pi",
	createdAt: now - 9 * 24 * 60 * 60_000,
};
export const WECHAT_BRIDGE: BridgeStatus = {
	open: true,
	expired: false,
	paused: false,
	running: true,
	owner: "owner@im.wechat",
	peerCount: 3,
	queued: 2,
	peerStates: [
		{ peer: "alice@im.wechat", state: { status: "running", queued: 0, runningMs: 48_000 } },
		{ peer: "bob@im.wechat", state: { status: "running", queued: 2, runningMs: 12_000 } },
		{ peer: "carol@im.wechat", state: { status: "idle", queued: 0 } },
	],
	refused: 1,
	refusedPeers: ["stranger@im.wechat"],
	mediaDropped: 0,
	promptPending: true,
	// Two peers run at once, so two of them can be waiting on a question.
	prompts: [
		{ peer: "alice@im.wechat", kind: "select", title: "Which migration should run first?", startedAt: now - 90_000 },
		{ peer: "bob@im.wechat", kind: "confirm", title: "Continue with the plan?", startedAt: now - 20_000 },
	],
	startedAt: now - 3 * 60 * 60_000,
	lastPollAt: now - 2_000,
};
export const WECHAT_VIEW = statusView(WECHAT_ACCOUNT, WECHAT_BRIDGE, now);
