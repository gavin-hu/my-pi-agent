/**
 * The chat's slash commands: how a line is parsed and matched, and what each
 * built-in replies — including the plan mode `/status` names, which the terminal
 * shows as a chip the chat cannot see.
 *
 * The commands run against a hand-built `SlashContext`, so the reply rules are
 * proved without a bridge, a session, or a timer; one case goes over the bridge,
 * because the mode travels from `index.ts` to the reply and nowhere else proves it.
 */

import { describe, expect, test } from "bun:test";
import { PLAN_MODE_ENTRY_TYPE } from "../../../lib/plan-state.ts";
import { withAgentDir } from "../../../test/helpers/env.ts";
import { emit } from "../../../test/helpers/fakes.ts";
import { inboundText, startWechat, updates, writeAccount } from "../../../test/helpers/fixtures/wechat.ts";
import { waitFor } from "../../../test/helpers/process.ts";
import {
	findSlashCommand,
	helpText,
	parseSlash,
	SLASH_COMMANDS,
	type SlashContext,
	type SlashPeerState,
	type StopOutcome,
} from "./slash.ts";

describe("slash parsing", () => {
	test("parses a bare command and trims the surrounding text", () => {
		expect(parseSlash("/new")).toEqual({ name: "new", args: "" });
		expect(parseSlash("  /new  ")).toEqual({ name: "new", args: "" });
	});

	test("lowercases the name and keeps the args", () => {
		expect(parseSlash("/NeW keep this")).toEqual({ name: "new", args: "keep this" });
		expect(parseSlash("/new\nmulti\nline")).toEqual({ name: "new", args: "multi\nline" });
	});

	test("rejects text that is not a command", () => {
		expect(parseSlash("hello")).toBeUndefined();
		expect(parseSlash("/")).toBeUndefined();
		expect(parseSlash("/ with space")).toBeUndefined();
	});

	test("findSlashCommand matches case-insensitively and ignores unknown names", () => {
		expect(findSlashCommand(SLASH_COMMANDS, "STOP")?.name).toBe("stop");
		expect(findSlashCommand(SLASH_COMMANDS, "new")).toBeUndefined();
		expect(findSlashCommand(SLASH_COMMANDS, "nope")).toBeUndefined();
		// A path-like message parses to a name that is not registered.
		expect(findSlashCommand(SLASH_COMMANDS, parseSlash("/usr/local")?.name ?? "")).toBeUndefined();
	});
});

describe("built-in /stop, /status, and /history", () => {
	function context(
		overrides: Partial<SlashContext> = {},
		state: SlashPeerState = { status: "idle", queued: 0 },
		history: (count: number) => Promise<string> = async () => "",
		outcome: StopOutcome = { stopped: state.status === "running", dropped: 0 },
	) {
		const replies: string[] = [];
		let stopped = 0;
		const ctx = {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text: string) => {
				replies.push(text);
			},
			activeTurn: state.status === "running",
			language: "en",
			session: {
				stop: () => {
					stopped += 1;
					return outcome;
				},
				status: () => state,
				history,
			},
			...overrides,
		} satisfies SlashContext;
		return { ctx, replies, stopped: () => stopped };
	}

	test("/stop asks the session to abort and stays quiet when it did", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies, stopped } = context({}, { status: "running", queued: 0 });
		await command?.run?.(ctx);
		expect(stopped()).toBe(1);
		// The stopped turn answers with its own `Stopped.`, so no second bubble.
		expect(replies).toEqual([]);
	});

	test("/stop says how many queued messages went with the turn", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies } = context({}, { status: "running", queued: 2 }, async () => "", {
			stopped: true,
			dropped: 2,
		});
		await command?.run?.(ctx);
		// `Stopped.` is the turn's line; this one is the queue the stop took with it.
		expect(replies).toEqual(["Dropped 2 queued message(s)."]);
	});

	test("/stop says how many dropped even when nothing was running", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies } = context({}, { status: "queued", queued: 3 }, async () => "", {
			stopped: false,
			dropped: 3,
		});
		await command?.run?.(ctx);
		expect(replies).toEqual(["Dropped 3 queued message(s)."]);
	});

	test("/stop says so when nothing is running", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "stop");
		const { ctx, replies } = context();
		await command?.run?.(ctx);
		expect(replies).toEqual(["Nothing is running right now."]);
	});

	test("/status reports the running turn and its queue", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "running", queued: 2, runningMs: 12_400 });
		await command?.run?.(ctx);
		expect(replies).toEqual(["Working — 12s so far, 2 queued."]);
	});

	test("/status names plan mode in the peer's language", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context(
			{ language: "zh" },
			{ status: "running", queued: 0, runningMs: 3000, planMode: true },
		);
		await command?.run?.(ctx);
		expect(replies).toEqual(["正在处理，已用 3 秒。计划模式已开启，暂时不能写入。"]);
	});

	test("/status says nothing about the mode while a dialog waits", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "running", queued: 0, prompt: "Approve the plan?", planMode: true });
		await command?.run?.(ctx);
		// The waiting dialog is the whole status, and a plan review's digest already
		// carried the mode.
		expect(replies[0]).toContain("Approve the plan?");
		expect(replies[0]).not.toContain("Plan mode is on");
	});

	test("/status names plan mode while idle", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "idle", queued: 0, planMode: true });
		await command?.run?.(ctx);
		// The mode is otherwise the terminal's chip, which the chat cannot read.
		expect(replies).toEqual(["Idle. Plan mode is on — writes are disabled."]);
	});

	test("/status reports an idle conversation", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context();
		await command?.run?.(ctx);
		expect(replies).toEqual(["Idle."]);
	});

	test("/status reports a queued conversation", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({}, { status: "queued", queued: 3 });
		await command?.run?.(ctx);
		expect(replies[0]).toContain("3");
	});

	test("/status answers a Chinese peer in Chinese", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context({ language: "zh" }, { status: "running", queued: 0, runningMs: 3000 });
		await command?.run?.(ctx);
		expect(replies[0]).toContain("正在处理，已用 3 秒");
	});

	test("/status names the dialog a blocked turn is waiting on", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "status");
		const { ctx, replies } = context(
			{},
			{ status: "running", queued: 0, runningMs: 3000, prompt: "Plan mode — what next?" },
		);
		await command?.run?.(ctx);
		// The dialog is the only thing the peer can act on, so it replaces the timer.
		expect(replies[0]).toContain("Plan mode — what next?");
		expect(replies[0]).toContain("cancel");
		expect(replies[0]).not.toContain("3s so far");
	});

	test("/history replies with the peer's own recent messages", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const { ctx, replies } = context({}, { status: "idle", queued: 0 }, async () => "You: hi\nMe: hello");
		await command?.run?.(ctx);
		expect(replies).toEqual(["You: hi\nMe: hello"]);
	});

	test("/history defaults to 8 and caps the request at 20", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const counts: number[] = [];
		const { ctx } = context({}, { status: "idle", queued: 0 }, async (count) => {
			counts.push(count);
			return "";
		});
		await command?.run?.({ ...ctx, args: "" });
		await command?.run?.({ ...ctx, args: "99" });
		expect(counts).toEqual([8, 20]);
	});

	test("/history says so when there is nothing yet", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "history");
		const { ctx, replies } = context({}, { status: "idle", queued: 0 });
		await command?.run?.(ctx);
		expect(replies).toEqual(["No history yet in this conversation."]);
	});
});

describe("built-in /help", () => {
	function context(events: string[]): SlashContext {
		return {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				events.push(text);
			},
			activeTurn: false,
			language: "en",
			session: { stop: () => ({ stopped: false, dropped: 0 }), status: () => ({ status: "idle", queued: 0 }) },
		};
	}

	test("replies with the command list", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		const replies: string[] = [];
		await command?.run?.(context(replies));
		expect(replies[0]).not.toContain("/new");
		expect(replies[0]).toMatch(/\/history \[n\] — .*[\s\S]*\/help — /);
		// The stop's own line names the queue, so the brake is not a surprise on the phone.
		expect(replies[0]).toContain("/stop — Stop the running answer and drop the queued messages");
		// Admission is the owner's, so there is no second, per-command gate to announce.
		expect(replies[0]).not.toContain("owner only");
	});

	test("replies in Chinese for a Chinese peer", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		const replies: string[] = [];
		await command?.run?.({ ...context(replies), language: "zh" });
		expect(replies[0]).toContain("可用命令：");
		expect(replies[0]).toContain("/stop — 停止当前回答并丢弃排队的消息");
		expect(replies[0]).not.toContain("owner only");
	});
});

describe("helpText", () => {
	test("lists each command", () => {
		const text = helpText([
			{ name: "new", summary: "Start a new session" },
			{ name: "help", usage: "help [topic]", summary: "List the chat commands" },
		]);
		expect(text).toContain("/new — Start a new session");
		expect(text).toContain("/help [topic] — List the chat commands");
		expect(text).toContain("reaches the agent");
	});

	test("speaks Chinese when the peer does, falling back to the English summary", () => {
		const text = helpText(
			[
				{ name: "new", summary: "Start a new session", summaryZh: "开始新会话" },
				{ name: "help", summary: "List the chat commands" },
			],
			"zh",
		);
		expect(text).toContain("/new — 开始新会话");
		// A command without a Chinese summary falls back to the English one.
		expect(text).toContain("/help — List the chat commands");
		expect(text).toContain("其他内容都会发送给助手。");
	});
});

describe("/status over the bridge", () => {
	test("names plan mode the branch is planning", async () => {
		await withAgentDir(async (dir) => {
			writeAccount(dir);
			// The mode is the branch's flag, so the case starts from a branch that carries it
			// and proves it travels the whole way: `index.ts` reads it, the bridge hands it to
			// the intake, and the command's reply is what the phone sees.
			const planning = [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }];
			const { fake, client, ctx } = await startWechat(dir, {
				branch: planning,
				script: [updates([inboundText("/status")])],
			});
			await waitFor(() => client.sent.length === 1);
			expect(client.sent[0]?.text).toBe("Idle. Plan mode is on — writes are disabled.");
			await emit(fake.pi, "session_shutdown", { type: "session_shutdown" }, ctx);
		});
	});
});
