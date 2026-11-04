/**
 * `/wechat cancel`: withdrawing the waiting prompt from a session that may have no
 * control screen to press `c` on.
 *
 * There is one conversation, so there is one prompt: the cases here are the four
 * answers the verb can give — withdrawn, nothing waiting, no bridge, and during a
 * turn — and the screen's `c` reads the same function for the same wording. The
 * bridge is a double: no network, no session, no timer.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { bridgeStatus } from "../../../test/helpers/fixtures/wechat.ts";
import type { Bridge, BridgeStatus } from "../bridge.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import type { PendingPromptInfo } from "../dialog/interaction.ts";
import { type CommandDeps, WECHAT_COMMANDS } from "./commands.ts";

const CANCEL = WECHAT_COMMANDS.find((command) => command.verb === "cancel");

const prompt: PendingPromptInfo = { peer: "owner@im.wechat", kind: "select", title: "Pick one", startedAt: 0 };

/** The verb over a bridge double: the prompt it waits on, and the cancels it took. */
function harness(prompts: readonly PendingPromptInfo[], options: { turnsRunning?: boolean } = {}) {
	const cancelled: number[] = [];
	const status: BridgeStatus = bridgeStatus({
		state: "running",
		turnsRunning: options.turnsRunning === true,
		prompts: [...prompts],
	});
	const bridge = {
		status: () => status,
		channel: () => ({ cancel: () => cancelled.push(1) }),
	} as unknown as Bridge;
	const deps: CommandDeps = {
		getBridge: () => bridge,
		startBridge: async () => "started",
		stopBridge: async () => false,
		loadConfig: () => DEFAULT_CONFIG,
		createLoginClient: () => {
			throw new Error("this verb opens no client");
		},
		saveAccount: () => {},
		storedAccount: () => undefined,
		readHistory: async () => "",
		logout: () => {},
		now: () => 0,
	};
	return { deps, cancelled };
}

/** Run the verb in a session with no control screen and report what it said. */
async function run(deps: CommandDeps) {
	if (!CANCEL) throw new Error("the verb table has no cancel verb");
	const { ctx, notices } = fakeCtx({ mode: "rpc" });
	await CANCEL.run(ctx, deps);
	return notices;
}

describe("/wechat cancel", () => {
	test("withdraws the waiting prompt", async () => {
		const { deps, cancelled } = harness([prompt]);
		expect(await run(deps)).toEqual([{ message: "Cancelled the waiting prompt.", kind: "info" }]);
		expect(cancelled).toEqual([1]);
	});

	test("says so when nothing is waiting, and withdraws nothing", async () => {
		const { deps, cancelled } = harness([]);
		expect(await run(deps)).toEqual([{ message: "No prompt is waiting.", kind: "info" }]);
		expect(cancelled).toEqual([]);
	});

	test("reports a bridge that is not started, which is why nothing is waiting", async () => {
		const { deps } = harness([]);
		const disconnected: CommandDeps = { ...deps, getBridge: () => undefined };
		expect(await run(disconnected)).toEqual([
			{
				message: "No prompt is waiting: the WeChat bridge is not started on this session. Run /wechat start.",
				kind: "warning",
			},
		]);
	});

	test("withdraws a prompt while a turn runs, which is when one waits", async () => {
		const { deps, cancelled } = harness([prompt], { turnsRunning: true });
		expect(await run(deps)).toEqual([{ message: "Cancelled the waiting prompt.", kind: "info" }]);
		expect(cancelled).toEqual([1]);
	});
});
