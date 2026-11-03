import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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
		peerCount: 1,
		queued: 2,
		turnsRunning: true,
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
		prompts: [],
		startedAt: doctorNow - 1000,
		lastPollAt: doctorNow - 3200,
		pollHoldMs: 18_000,
		tokenCreatedAt: doctorAccount.createdAt,
		lock: { pid: 1234, at: doctorNow - 240_000 },
		...overrides,
	};
}

/** The column the value starts at, for a peer line whose value is `value`. */
function valueColumn(line: string, value: string): number {
	return visibleWidth(line.slice(0, line.indexOf(value)));
}

describe("doctorReport", () => {
	test("reports the connection, poll, lock, peers, media, and config", () => {
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
		expect(text).toContain("1 running");
		expect(text).toContain("2 queued");
		expect(text).toContain("alice");
		expect(text).toContain("running 42s");
		expect(text).toContain("session 1h00m");
		expect(text).toContain("2 dropped");
		expect(text).toContain("refused 1 (bob)");
		expect(text).toContain("no prompt");
		expect(text).toContain("typing on");
		expect(text).toContain("prompts on");
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

	test("treats a paused bridge as resumable", () => {
		const text = doctorReport({
			status: doctorStatus({ state: "paused", peerStates: [], queued: 0, lock: undefined }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("paused");
		expect(text).toContain("/wechat resume");
	});

	test("treats an expired bridge as needing a login", () => {
		const text = doctorReport({
			status: doctorStatus({ state: "expired", peerStates: [], queued: 0, lock: undefined }),
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
		expect(text).toContain("none");
		expect(text).toContain("no recent failure");
	});

	test("reports a full queue and a waiting prompt", () => {
		const text = doctorReport({
			status: doctorStatus({ peerStates: [], queued: 8, promptPending: true }),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).toContain("prompt waiting");
	});

	test("counts the configured peer overrides and turn cap", () => {
		const text = doctorReport({
			status: doctorStatus(),
			account: doctorAccount,
			config: { ...DEFAULT_CONFIG, allowedPeers: ["bob"], peers: { bob: { tools: ["read"] } }, maxTurnsPerHour: 12 },
			now: doctorNow,
		});
		expect(text).toContain("1 allowed");
		expect(text).toContain("1 peer override(s)");
		expect(text).toContain("12 turns/h");
	});

	test("aligns a wide peer label's value with an ASCII one", () => {
		const text = doctorReport({
			status: doctorStatus({
				peerStates: [
					{ peer: "alice@im.wechat", state: { status: "idle", queued: 0 } },
					{ peer: "李雷@im.wechat", state: { status: "idle", queued: 0 } },
				],
			}),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		const lines = text.split("\n");
		const ascii = lines.find((line) => line.includes("alice")) ?? "";
		const wide = lines.find((line) => line.includes("李雷")) ?? "";
		expect(valueColumn(ascii, "idle")).toBe(valueColumn(wide, "idle"));
	});

	test("strips control characters a peer put in its id", () => {
		const text = doctorReport({
			status: doctorStatus({
				peerStates: [
					{
						peer: "bad\u001b[31m@im.wechat",
						state: { status: "idle", queued: 0, sessionAgeMs: 1000 },
					},
				],
				refusedPeers: ["\u0007bob"],
				lastPollError: "rejected\u001b[0m ret -1",
			}),
			account: doctorAccount,
			config: DEFAULT_CONFIG,
			now: doctorNow,
		});
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u0007");
		expect(text).toContain("bad [31m");
	});
});
