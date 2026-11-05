/**
 * Withdrawing the waiting prompt, from either surface: `/wechat cancel` at a
 * terminal that may have no control screen to press `c` on, and `/cancel` — or
 * the documented `/wechat cancel` — typed into the chat.
 *
 * There is one conversation, so there is one prompt: the cases here are the four
 * answers the verb can give — withdrawn, nothing waiting, no bridge, and during a
 * turn — the two chat spellings, and the one thing that went wrong before they
 * existed: a prompt reading `/cancel` as the answer it was meant to escape. The
 * bridge is a double: no network, no session, no timer.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { controllableClient, inbound, makeDeps } from "../../../test/helpers/fixtures/wechat-bridge.ts";
import { bridgeStatus } from "../../../test/helpers/fixtures/wechat.ts";
import { waitFor } from "../../../test/helpers/process.ts";
import { type Bridge, type BridgeStatus, createBridge } from "../bridge.ts";
import { DEFAULT_CONFIG } from "../config.ts";
import type { PendingPromptInfo } from "../dialog/interaction.ts";
import type { PeerLanguage } from "../text/format.ts";
import { type CommandDeps, WECHAT_COMMANDS } from "./commands.ts";
import { findSlashCommand, resolveSlash, SLASH_COMMANDS, type SlashContext, type SlashPeerState } from "./slash.ts";

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
				message: "No prompt is waiting: this session runs no bridge. Run /wechat login, then /wechat start.",
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

describe("chat /cancel", () => {
	/** The name the chat's own lookup gives a typed line, if any. */
	const named = (text: string) => resolveSlash(SLASH_COMMANDS, text)?.command.name;

	test("resolves /cancel and the documented /wechat cancel to one command", () => {
		expect(named("/cancel")).toBe("cancel");
		// The terminal verb is what a screen-less session was told to type, and a phone
		// has no terminal, so the same words have to reach the same command.
		expect(named("/wechat cancel")).toBe("cancel");
		expect(named("/WECHAT CANCEL")).toBe("cancel");
		expect(named("/wechat cancel now")).toBe("cancel");
		// Nothing else is drawn into it: another `/wechat` verb stays ordinary text.
		expect(named("/withdraw")).toBeUndefined();
		expect(named("/wechat status")).toBeUndefined();
	});

	/** The command over the controls the bridge binds, recording what it was asked for. */
	function chatContext(options: { waiting?: string; language?: PeerLanguage } = {}) {
		const replies: string[] = [];
		let cancels = 0;
		const waiting = options.waiting;
		const ctx = {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text: string) => {
				replies.push(text);
			},
			activeTurn: waiting !== undefined,
			language: options.language ?? "en",
			session: {
				stop: () => false,
				status: () => ({ status: "running", queued: 0, prompt: waiting }) as SlashPeerState,
				cancel: () => {
					cancels += 1;
					return waiting !== undefined;
				},
			},
		} satisfies SlashContext;
		return { ctx, replies, cancels: () => cancels };
	}

	test("withdraws the waiting question and adds no second bubble", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "cancel");
		const { ctx, replies, cancels } = chatContext({ waiting: "Proceed?" });
		await command?.run?.(ctx);
		// The withdrawal sends `That question was withdrawn.` itself, as /stop
		// leaves `Stopped.` to the turn it stopped.
		expect(cancels()).toBe(1);
		expect(replies).toEqual([]);
	});

	test("says so when nothing is waiting, in the peer's language", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "cancel");
		const idle = chatContext();
		await command?.run?.(idle.ctx);
		expect(idle.replies).toEqual(["No question is waiting for your reply."]);
		const chinese = chatContext({ language: "zh" });
		await command?.run?.(chinese.ctx);
		expect(chinese.replies[0]).toMatch(/[\u3400-\u9fff]/);
	});
});

describe("a chat cancel over the bridge", () => {
	/** Ask a question in a chat turn, send `spelling`, and report how it was answered. */
	async function escapeWith(spelling: string) {
		const { client, sent, deliver } = controllableClient();
		const { deps, injected } = makeDeps(client, {}, { hold: true });
		const bridge = createBridge(deps);
		bridge.open();
		await waitFor(() => injected.length === 1);
		const answer = bridge.channel().request({ kind: "input", title: "Name?" });
		await waitFor(() => bridge.channel().hasPending());

		deliver(inbound(spelling));
		// An `input` prompt would otherwise take this text as its value.
		await waitFor(() => sent.some((item) => item.text === "That question was withdrawn."));
		expect(bridge.channel().hasPending()).toBe(false);
		expect(bridge.status().prompts).toEqual([]);
		expect(await answer).toEqual({ kind: "cancelled" });
		await bridge.close();
	}

	test("withdraws the question /cancel was typed to escape", async () => {
		await escapeWith("/cancel");
	});

	test("withdraws it for the documented /wechat cancel as well", async () => {
		await escapeWith("/wechat cancel");
	});
});
