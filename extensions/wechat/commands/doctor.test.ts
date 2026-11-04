import { describe, expect, test } from "bun:test";
import type { BridgeStatus } from "../bridge.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import type { BotCredentials } from "../types.ts";
import { doctorReport } from "./doctor.ts";

const doctorNow = 10_000_000;
const doctorAccount: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: doctorNow - 2 * 60 * 60 * 1000,
};

function doctorStatus(overrides: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		state: "running",
		owner: "owner@im.wechat",
		queued: 2,
		turnsRunning: true,
		turn: { status: "running", queued: 2, runningMs: 42_000, sessionAgeMs: 60 * 60 * 1000 },
		refused: 1,
		refusedPeers: ["bob"],
		mediaDropped: 2,
		promptPending: false,
		prompts: [],
		startedAt: doctorNow - 1000,
		lastPollAt: doctorNow - 3200,
		pollHoldMs: 18_000,
		lock: { pid: 1234, at: doctorNow - 240_000 },
		...overrides,
	};
}

describe("doctorReport", () => {
	test("reports the connection, poll, lock, turn, media, and config", () => {
		const text = doctorReport({
			status: doctorStatus(),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("wechat");
		expect(text).toContain("health");
		expect(text).toContain("owner owner");
		expect(text).toContain("2h00m old");
		expect(text).toContain("last 3.2s");
		expect(text).toContain("hold 18.0s");
		expect(text).toContain("pid 1234");
		expect(text).toContain("4m00s ago");
		expect(text).toContain("2 queued");
		expect(text).toContain("running 42s");
		expect(text).toContain("session 1h00m");
		expect(text).toContain("2 dropped");
		expect(text).toContain("refused 1 (bob)");
		expect(text).toContain("no prompt");
		expect(text).toContain("typing on");
	});

	test("reports the last poll and send failures", () => {
		const text = doctorReport({
			status: doctorStatus({ lastPollError: "rejected ret -1", lastSendError: "context token invalid" }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("send: context token invalid");
		expect(text).toContain("poll: rejected ret -1");
	});

	test("points a stopped bridge at the start command", () => {
		const text = doctorReport({
			status: doctorStatus({ state: "stopped", turn: { status: "idle", queued: 0 }, queued: 0, lock: undefined }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("closed");
		expect(text).toContain("/wechat start");
	});

	test("treats an expired bridge as needing a login", () => {
		const text = doctorReport({
			status: doctorStatus({ state: "expired", turn: { status: "idle", queued: 0 }, queued: 0, lock: undefined }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("expired");
		expect(text).toContain("/wechat login");
		expect(text).toContain("not running");
	});

	test("reports a never-started bridge without inventing facts", () => {
		const text = doctorReport({ status: undefined, account: undefined, config: DEFAULT_CONFIG, now: doctorNow });
		expect(text).toContain("closed");
		expect(text).toContain("not started");
		expect(text).toContain("not running");
		expect(text).toContain("no recent failure");
	});

	test("reports a full queue and a waiting prompt", () => {
		const text = doctorReport({
			status: doctorStatus({ turn: { status: "idle", queued: 8 }, queued: 8, promptPending: true }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("prompt waiting");
	});

	test("names the configured turn cap", () => {
		const text = doctorReport({
			status: doctorStatus(),
			account: doctorAccount,
			config: { ...DEFAULT_CONFIG, maxTurnsPerHour: 12 },
			now: doctorNow,
		});
		expect(text).toContain("12 turns/h");
	});

	test("strips control characters a peer put in its id", () => {
		const text = doctorReport({
			status: doctorStatus({
				turn: { status: "idle", queued: 0, sessionAgeMs: 1000 },
				refusedPeers: ["\u0007bob"],
				lastPollError: "rejected\u001b[0m ret -1",
			}),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
	});
});
