import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "./config.ts";
import { doctorReport } from "./doctor.ts";
import type { BridgeStatus } from "./bridge.ts";
import type { BotCredentials } from "./types.ts";

const now = 10_000_000;
const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: now - 2 * 60 * 60 * 1000,
};

function status(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		open: true,
		expired: false,
		paused: false,
		owner: "owner@im.wechat",
		peerCount: 1,
		queued: 2,
		running: true,
		peerStates: [
			{
				peer: "alice@im.wechat",
				state: { status: "running", queued: 2, runningMs: 42_000, sessionAgeMs: 60 * 60 * 1000 },
			},
		],
		refused: 1,
		refusedPeers: ["bob"],
		mediaDropped: 2,
		promptPending: false,
		startedAt: now - 1000,
		lastPollAt: now - 3200,
		pollHoldMs: 18_000,
		tokenCreatedAt: account.createdAt,
		lock: { pid: 1234, at: now - 240_000 },
		...overrides,
	};
}

describe("doctorReport", () => {
	test("reports the connection, poll, lock, peers, and config", () => {
		const text = doctorReport({ status: status(), account, config: DEFAULT_CONFIG, now });
		expect(text.split("\n")[0]).toBe("wechat — health");
		expect(text).toContain("open · owner owner · token 2h00m old");
		expect(text).toContain("last 3.2s ago · hold 18.0s");
		expect(text).toContain("pid 1234 · 4m00s ago");
		expect(text).toContain("1 · 1 running · 2 queued");
		expect(text).toContain("alice");
		expect(text).toContain("running 42.0s · session 1h00m");
		expect(text).toContain("2 dropped · 1 refused (bob) · no prompt");
		expect(text).toContain("typing on · prompts on");
	});

	test("reports the last poll and send failures", () => {
		const text = doctorReport({
			status: status({ lastPollError: "rejected ret -1", lastSendError: "context token invalid" }),
			account,
			config: DEFAULT_CONFIG,
			now,
		});
		expect(text).toContain("error: rejected ret -1");
		expect(text).toContain("send: context token invalid");
	});

	test("treats a paused bridge as resumable", () => {
		const text = doctorReport({
			status: status({ open: false, paused: true, peerStates: [], queued: 0, lock: undefined }),
			account,
			config: DEFAULT_CONFIG,
			now,
		});
		expect(text).toContain("paused · run /wechat resume");
	});

	test("treats an expired bridge as needing a login", () => {
		const text = doctorReport({
			status: status({ open: false, expired: true, peerStates: [], queued: 0, lock: undefined }),
			account,
			config: DEFAULT_CONFIG,
			now,
		});
		expect(text).toContain("expired · run /wechat login");
		expect(text).toContain("not running");
	});

	test("reports a never-started bridge without inventing facts", () => {
		const text = doctorReport({ status: undefined, account: undefined, config: DEFAULT_CONFIG, now });
		expect(text).toContain("closed");
		expect(text).toContain("not started");
		expect(text).toContain("not running");
		expect(text).toContain("none");
		expect(text).toContain("no recent failure");
	});

	test("reports a full queue and a waiting prompt", () => {
		const text = doctorReport({
			status: status({ peerStates: [], queued: 8, promptPending: true }),
			account,
			config: DEFAULT_CONFIG,
			now,
		});
		expect(text).toContain("prompt waiting");
	});

	test("counts the configured peer overrides and turn cap", () => {
		const text = doctorReport({
			status: status(),
			account,
			config: { ...DEFAULT_CONFIG, allowedPeers: ["bob"], peers: { bob: { tools: ["read"] } }, maxTurnsPerHour: 12 },
			now,
		});
		expect(text).toContain("1 allowed · 1 peer override(s) · 12 turns/h");
	});
});
