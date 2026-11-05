/**
 * The operator command surface and the peer-facing conversation pieces: the
 * `/wechat` verb table, its dialogs and login/logout handling, the notice
 * catalog, prompt rendering and parsing, the interaction channel, and the chat
 * turn's UI context. The chat's own slash commands are `slash.test.ts`.
 *
 * The bridge, the client, and the terminal context are doubles, so this suite
 * proves the wiring and the reply rules without a network, a session, or a real
 * timer.
 */

import { describe, expect, test } from "bun:test";
import { type InteractionRequest, INTERACTION_OTHER_LABEL } from "../../../lib/interaction.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { createFakePi } from "../../../test/helpers/fakes.ts";
import { bridgeStatus, commandHarness as harness } from "../../../test/helpers/fixtures/wechat.ts";
import type { WechatClient } from "../transport/client.ts";
import { finishLogin, registerCommands, runNew, WECHAT_COMMANDS, WECHAT_USAGE, type CommandDeps } from "./commands.ts";
import type { PeerLanguage } from "../text/format.ts";
import {
	createWechatInteractionChannel,
	PROMPT_TIMEOUT_MS,
	type WechatInteractionDeps,
} from "../dialog/interaction.ts";
import { notice, NOTICE_KINDS } from "../text/notices.ts";
import { formatPrompt, parsePromptAnswer, RETRY_NOTICE } from "../dialog/prompt.ts";
import type { ArmTimer } from "../timer.ts";
import type { BotCredentials } from "../types.ts";

const account: BotCredentials = {
	botToken: "t",
	ilinkUserId: "owner@im.wechat",
	ilinkBotId: "b",
	baseUrl: "https://base",
	botAgent: "ag",
	createdAt: 0,
};

function handler(deps: CommandDeps) {
	const fake = createFakePi();
	registerCommands(fake.pi, deps);
	const registered = fake.commands.get("wechat")?.handler;
	if (!registered) throw new Error("command not registered");
	return registered;
}

describe("the /wechat verb table", () => {
	test("completes every verb, with the description help shows", () => {
		const fake = createFakePi();
		registerCommands(fake.pi, harness().deps);
		const complete = fake.commands.get("wechat")?.getArgumentCompletions;
		if (!complete) throw new Error("completions not registered");
		const items = complete("") ?? [];
		expect(items.map((item: { label: string }) => item.label)).toEqual(WECHAT_COMMANDS.map((command) => command.verb));
		for (const item of items) {
			const command = WECHAT_COMMANDS.find((entry) => entry.verb === item.label);
			expect(item.description).toBe(command?.description);
		}
		expect(complete("lo")).toEqual([
			{ value: "login", label: "login", description: expect.stringContaining("QR") },
			{ value: "logout", label: "logout", description: expect.stringContaining("account") },
		]);
		expect(complete("login ")).toBeNull();
	});

	test("help lists the usage line and every verb with its description", async () => {
		const { deps } = harness();
		const { ctx, notices } = fakeCtx();
		await handler(deps)("help", ctx);
		const help = notices.at(-1)?.message ?? "";
		expect(help.split("\n")[0]).toBe(`wechat commands — ${WECHAT_USAGE}`);
		for (const command of WECHAT_COMMANDS) {
			expect(help).toContain(`/wechat ${command.verb} — ${command.description}`);
		}
	});

	test("warns on an unknown subcommand instead of silently showing status", async () => {
		const { deps } = harness();
		const { ctx, notices, customCalls } = fakeCtx({ custom: "close" });
		await handler(deps)("restart", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain('Unknown wechat command "restart"');
		expect(notices.at(-1)?.message).toContain("Try /wechat start");
		expect(customCalls).toEqual([]);
	});
});

describe("the control screen", () => {
	test("opens for a bare command and runs the chosen action", async () => {
		const started: number[] = [];
		const { deps } = harness();
		const { ctx, customCalls } = fakeCtx({
			custom: { verb: "new" },
			extra: {
				newSession: async () => {
					started.push(1);
					return { cancelled: false };
				},
			},
		});
		await handler(deps)("", ctx);
		expect(customCalls.length).toBe(1);
		expect(started).toEqual([1]);
	});

	test("closes without dispatching when the screen closes", async () => {
		const { deps } = harness();
		const { ctx, customCalls, notices } = fakeCtx({ custom: "close" });
		await handler(deps)("status", ctx);
		expect(customCalls.length).toBe(1);
		expect(notices).toEqual([]);
	});

	test("stores the account and points at the start command", async () => {
		const { deps, saved, events } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "confirmed", account }, ctx, deps);
		expect(saved).toEqual([account]);
		// A scan is not a start: the bridge opens only when a person asks it to.
		expect(events).toEqual([]);
		expect(notices.at(-1)?.message).toContain("/wechat start");
	});

	test("reports an expired QR without touching credentials or the bridge", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "expired" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("expired");
	});

	test("reports a login error without connecting", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "error", message: "boom" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices.at(-1)).toEqual({ message: "WeChat login failed: boom", kind: "error" });
	});

	test("stays silent on cancel", async () => {
		const { deps, saved, opens } = harness();
		const { ctx, notices } = fakeCtx();
		await finishLogin({ kind: "cancelled" }, ctx, deps);
		expect(saved).toEqual([]);
		expect(opens()).toBe(0);
		expect(notices).toEqual([]);
	});
});

describe("/wechat login", () => {
	test("declines outside the TUI, where the QR screen has nothing to draw on", async () => {
		const { deps } = harness();
		const { ctx, notices, customCalls } = fakeCtx({ mode: "rpc" });
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("interactive terminal UI");
		expect(customCalls).toEqual([]);
	});

	test("reports a QR fetch failure without opening the screen", async () => {
		const { deps } = harness();
		deps.createLoginClient = async () =>
			({
				fetchQr: async () => {
					throw new Error("ilink down");
				},
			}) as unknown as WechatClient;
		const { ctx, notices, customCalls } = fakeCtx();
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("error");
		expect(notices.at(-1)?.message).toContain("ilink down");
		expect(customCalls).toEqual([]);
	});

	test("stores the scanned account and points at the start command", async () => {
		const { deps, saved, opens } = harness();
		deps.createLoginClient = async () =>
			({
				fetchQr: async () => ({ qrcode: "Q", imgContent: "url" }),
			}) as unknown as WechatClient;
		const { ctx, notices, customCalls } = fakeCtx({ custom: { kind: "confirmed", account } });
		await handler(deps)("login", ctx);
		expect(customCalls.length).toBe(1);
		expect(saved).toEqual([account]);
		// One scan stores the account; the bridge is opened by hand afterwards.
		expect(opens()).toBe(0);
		expect(notices.at(-1)?.message).toContain("/wechat start");
	});
});

describe("/wechat new", () => {
	test("starts a new session through the command context", async () => {
		let started = 0;
		const { ctx } = fakeCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await runNew(ctx, harness().deps);
		expect(started).toBe(1);
	});

	test("declines while a peer turn runs", async () => {
		let started = 0;
		const { deps } = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }) });
		const { ctx, notices } = fakeCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await runNew(ctx, deps);
		// Replacing the session here would stop the bridge and drop the peer's turn.
		expect(started).toBe(0);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat new");
	});
});

describe("/wechat history", () => {
	test("prints a peer's recent history", async () => {
		const h = harness();
		h.deps.readHistory = async (count) => `${count}\nYou: hi`;
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("history", ctx);
		const text = notices.at(-1)?.message ?? "";
		expect(text).toContain("10");
		expect(text).toContain("You: hi");
	});

	test("caps the requested count at 20", async () => {
		const counts: number[] = [];
		const h = harness();
		h.deps.readHistory = async (count) => {
			counts.push(count);
			return "You: hi";
		};
		const { ctx } = fakeCtx();
		await handler(h.deps)("history 99", ctx);
		expect(counts).toEqual([20]);
	});

	test("defaults to ten messages", async () => {
		const counts: number[] = [];
		const h = harness();
		h.deps.readHistory = async (count) => {
			counts.push(count);
			return "You: hi";
		};
		const { ctx } = fakeCtx();
		await handler(h.deps)("history", ctx);
		expect(counts).toEqual([10]);
	});

	test("reports a read failure instead of failing the command", async () => {
		const h = harness();
		h.deps.readHistory = async () => {
			throw new Error("disk gone");
		};
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("history alice", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("disk gone");
	});
});

describe("/wechat start and stop", () => {
	test("starts the bridge on this session, and says when it already runs", async () => {
		const first = harness({ account });
		const opened = fakeCtx();
		await handler(first.deps)("start", opened.ctx);
		expect(first.events).toEqual(["start"]);
		expect(opened.notices.at(-1)?.message).toContain("WeChat bridge started as owner");

		const running = harness({ start: "already-running" });
		const second = fakeCtx();
		await handler(running.deps)("start", second.ctx);
		expect(second.notices.at(-1)?.message).toContain("already running");
	});

	test("reports a refused start, and declines a mode with no session to keep", async () => {
		const refused = harness({ startError: "Not logged in. Run /wechat login first." });
		const { ctx, notices } = fakeCtx();
		await handler(refused.deps)("start", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat login");

		const ephemeral = harness();
		const json = fakeCtx({ mode: "json" });
		await handler(ephemeral.deps)("start", json.ctx);
		expect(ephemeral.events).toEqual([]);
		expect(json.notices.at(-1)?.message).toContain("tui or rpc");
	});

	test("stops the bridge, and says so when nothing runs", async () => {
		const stopped = harness({ stop: true });
		const first = fakeCtx();
		await handler(stopped.deps)("stop", first.ctx);
		expect(stopped.events).toEqual(["stop"]);
		expect(first.notices.at(-1)?.message).toBe("WeChat bridge stopped on this session.");

		const idle = harness({ stop: false });
		const second = fakeCtx();
		await handler(idle.deps)("stop", second.ctx);
		expect(second.notices.at(-1)?.message).toContain("not running");
	});
});

describe("/wechat doctor", () => {
	test("prints a health report", async () => {
		const { deps } = harness({ status: bridgeStatus({ state: "running", lastPollAt: 500, lock: { pid: 1, at: 1 } }) });
		const { ctx, notices } = fakeCtx();
		await handler(deps)("doctor", ctx);
		const text = notices.at(-1)?.message ?? "";
		expect(text).toContain("wechat — health");
		expect(text).toContain("Poll");
		expect(text).toContain("Lock");
	});
});

describe("/wechat logout", () => {
	test("needs a confirmation dialog, which some modes have no UI for", async () => {
		const { deps, logouts } = harness();
		const { ctx, notices } = fakeCtx({ mode: "json" });
		await handler(deps)("logout", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("confirmation dialog");
		expect(logouts()).toBe(0);
	});

	test("leaves the bridge alone when the confirmation is declined", async () => {
		const { deps, events, logouts } = harness();
		const { ctx, confirms } = fakeCtx({ confirm: false });
		await handler(deps)("logout", ctx);
		expect(confirms.length).toBe(1);
		expect(events).toEqual([]);
		expect(logouts()).toBe(0);
	});

	test("closes the bridge and clears the account on confirmation", async () => {
		const { deps, events, logouts } = harness();
		const { ctx, notices } = fakeCtx({ confirm: true });
		await handler(deps)("logout", ctx);
		expect(events).toEqual(["close"]);
		expect(logouts()).toBe(1);
		expect(notices.at(-1)?.message).toBe("WeChat logged out.");
	});
});

describe("the chat's turn", () => {
	test("stops the running turn instead of the bridge", async () => {
		const h = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }), stop: true });
		const { ctx, notices } = fakeCtx();
		await handler(h.deps)("cancel", ctx);
		expect(notices.at(-1)?.message).toContain("No prompt is waiting");
	});

	test("opens the screen on a session that runs no bridge", async () => {
		const h = harness({ bridge: false });
		const { ctx, customCalls } = fakeCtx({ custom: "close" });
		await handler(h.deps)("status", ctx);
		expect(customCalls).toHaveLength(1);
	});
});

/**
 * While a peer turn runs, the terminal's own dialogs still work (the bridge does
 * not adapt the host UI), but a `/wechat` verb that would stop the bridge or
 * replace the host session declines instead.
 */
describe("the /wechat command during a WeChat turn", () => {
	test("prints the one-line summary instead of opening the control screen", async () => {
		const { deps } = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }) });
		const { ctx, notifications, customCalls } = fakeCtx({ custom: "close" });
		await handler(deps)("status", ctx);
		expect(customCalls).toEqual([]);
		expect(notifications.at(-1)).toContain("wechat:");
	});

	test("declines logout before asking for a confirmation", async () => {
		const { deps, logouts } = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }) });
		const { ctx, notices, confirms } = fakeCtx({ hasUI: true, confirm: true });
		await handler(deps)("logout", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat logout");
		expect(confirms).toEqual([]);
		expect(logouts()).toBe(0);
	});

	test("declines new instead of replacing the session under the turn", async () => {
		let started = 0;
		const { deps } = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }) });
		const { ctx, notices } = fakeCtx({
			extra: {
				newSession: async () => {
					started += 1;
					return { cancelled: false };
				},
			},
		});
		await handler(deps)("new", ctx);
		expect(started).toBe(0);
		expect(notices.at(-1)?.message).toContain("/wechat new");
	});

	test("declines login before fetching a QR code", async () => {
		const { deps } = harness({ status: bridgeStatus({ state: "running", turnsRunning: true }) });
		const { ctx, notices } = fakeCtx();
		// The harness login client throws, so reaching it would fail this test.
		await handler(deps)("login", ctx);
		expect(notices.at(-1)?.kind).toBe("warning");
		expect(notices.at(-1)?.message).toContain("/wechat login");
	});

	test("opens the control screen again once the peer turn settles", async () => {
		const running = bridgeStatus({ state: "running", turnsRunning: true });
		const { deps } = harness({ status: running });
		const { ctx, customCalls } = fakeCtx({ custom: "close" });
		const command = handler(deps);
		await command("status", ctx);
		expect(customCalls).toEqual([]);

		// The bridge reports the turn gone; the next `/wechat` is local again.
		running.turnsRunning = false;
		await command("status", ctx);
		expect(customCalls.length).toBe(1);
	});
});

describe("notices", () => {
	// Derived from the catalogue, so a new kind is covered by these checks the day
	// it is added.
	test("renders the peer's language only", () => {
		const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/;
		for (const kind of NOTICE_KINDS) {
			expect(cjk.test(notice(kind, "zh"))).toBe(true);
			expect(cjk.test(notice(kind, "en"))).toBe(false);
		}
	});

	test("fills in a count", () => {
		expect(notice("media", "en", 2)).toContain("2");
		expect(notice("media", "zh", 2)).toContain("2 个附件");
	});

	test("keeps every notice to one line", () => {
		for (const kind of NOTICE_KINDS) {
			for (const lang of ["en", "zh"] as const) expect(notice(kind, lang)).not.toContain("\n");
		}
	});
});

describe("formatPrompt", () => {
	function request(
		partial: Partial<InteractionRequest> & Pick<InteractionRequest, "kind" | "title">,
	): InteractionRequest {
		return partial;
	}

	test("numbers select options and appends the hint", () => {
		const text = formatPrompt(
			request({ kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] }),
			{ language: "zh" },
		);
		expect(text).toContain("Pick");
		expect(text).toContain("1. A");
		expect(text).toContain("2. B");
		expect(text).toContain("3. Other (type something)");
		expect(text).toContain("取消");
	});

	test("renders one language per peer", () => {
		const request: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };
		const zh = formatPrompt(request, { language: "zh" });
		const en = formatPrompt(request, { language: "en" });
		expect(zh).toContain("回复编号");
		expect(zh).not.toContain("Reply with a number");
		expect(en).toContain("Reply with a number");
		expect(en).not.toContain("回复编号");
	});

	test("does not promise free text when the select has no Other option", () => {
		const text = formatPrompt(request({ kind: "select", title: "Plan mode", options: ["Approve", "Exit"] }), {
			language: "zh",
		});
		expect(text).not.toContain("anything else becomes");
		expect(text).toContain("回复编号或选项文字");
		expect(text).toContain("取消");
	});

	test("prepends the retry notice only when asked", () => {
		const confirm = request({ kind: "confirm", title: "Sure?" });
		expect(formatPrompt(confirm)).not.toContain("didn't recognize");
		expect(formatPrompt(confirm, { retry: true }).startsWith(RETRY_NOTICE)).toBe(true);
	});

	test("includes the confirm body and the editor's prefill", () => {
		expect(formatPrompt(request({ kind: "confirm", title: "Sure?", message: "This deletes files." }))).toContain(
			"This deletes files.",
		);
		expect(formatPrompt(request({ kind: "editor", title: "Edit", prefill: "line one" }))).toContain("line one");
	});
});

describe("parsePromptAnswer select", () => {
	const base: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B", INTERACTION_OTHER_LABEL] };

	test("maps a number to its option", () => {
		expect(parsePromptAnswer(base, "2")).toEqual({ kind: "value", value: "B" });
	});

	test("maps an exact label case-insensitively", () => {
		expect(parsePromptAnswer(base, "a")).toEqual({ kind: "value", value: "A" });
	});

	test("treats free text as the other option", () => {
		expect(parsePromptAnswer(base, "something else")).toEqual({ kind: "other", text: "something else" });
	});

	test("cancels on a cancel word", () => {
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "退出")).toEqual({ kind: "cancelled" });
	});

	test("recognizes an exit-plan phrase as a cancel", () => {
		expect(parsePromptAnswer(base, "退出 plan 模式")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit plan mode")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "leave plan")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(base, "exit code")).toEqual({ kind: "other", text: "exit code" });
	});

	test("retries an out-of-range number", () => {
		expect(parsePromptAnswer(base, "9")).toEqual({ kind: "retry" });
	});

	test("retries free text when there is no other option", () => {
		const noOther: InteractionRequest = { kind: "select", title: "Pick", options: ["A", "B"] };
		expect(parsePromptAnswer(noOther, "huh")).toEqual({ kind: "retry" });
	});

	test("retries empty input", () => {
		expect(parsePromptAnswer(base, "  ")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer confirm", () => {
	const base: InteractionRequest = { kind: "confirm", title: "Sure?" };

	test("accepts yes words", () => {
		expect(parsePromptAnswer(base, "是")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "YES")).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("accepts no words and cancel as false", () => {
		expect(parsePromptAnswer(base, "否")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "取消")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("accepts the everyday Chinese answers", () => {
		expect(parsePromptAnswer(base, "确定")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "行")).toEqual({ kind: "confirmed", confirmed: true });
		expect(parsePromptAnswer(base, "不是")).toEqual({ kind: "confirmed", confirmed: false });
		expect(parsePromptAnswer(base, "不行")).toEqual({ kind: "confirmed", confirmed: false });
	});

	test("retries anything else", () => {
		expect(parsePromptAnswer(base, "maybe")).toEqual({ kind: "retry" });
	});
});

describe("parsePromptAnswer input and editor", () => {
	test("input returns the text, cancels on a cancel word, and retries empty", () => {
		const input: InteractionRequest = { kind: "input", title: "Name" };
		expect(parsePromptAnswer(input, "Ada")).toEqual({ kind: "value", value: "Ada" });
		expect(parsePromptAnswer(input, "取消")).toEqual({ kind: "cancelled" });
		expect(parsePromptAnswer(input, "")).toEqual({ kind: "retry" });
	});

	test("editor returns the text and treats empty as cancelled", () => {
		const editor: InteractionRequest = { kind: "editor", title: "Edit" };
		expect(parsePromptAnswer(editor, "1, 3")).toEqual({ kind: "value", value: "1, 3" });
		expect(parsePromptAnswer(editor, "")).toEqual({ kind: "cancelled" });
	});

	test("strips control characters", () => {
		expect(parsePromptAnswer({ kind: "input", title: "Name" }, "A\u0007da")).toEqual({ kind: "value", value: "A da" });
	});
});

/** A timer seam keyed by delay, so the reminder and the expiry fire apart. */
function timerSeam(): { arm: ArmTimer; fire: (ms: number) => void; armed: () => number } {
	const pending = new Map<number, { ms: number; fn: () => void }>();
	let next = 0;
	return {
		arm: (ms, fn) => {
			next += 1;
			const id = next;
			pending.set(id, { ms, fn });
			return () => pending.delete(id);
		},
		fire: (ms) => {
			for (const [id, timer] of [...pending]) {
				if (timer.ms !== ms) continue;
				pending.delete(id);
				timer.fn();
			}
		},
		armed: () => pending.size,
	};
}

const SELECT: InteractionRequest = {
	kind: "select",
	title: "Pick",
	options: ["A", "B", INTERACTION_OTHER_LABEL],
};
const INPUT: InteractionRequest = { kind: "input", title: "Name" };
const CONFIRM: InteractionRequest = { kind: "confirm", title: "Sure?" };

/** One peer's interaction channel over recording senders and a mutable "turn runs". */
function setupChannel(
	options: { timer?: ArmTimer; language?: PeerLanguage; now?: () => number; active?: boolean } = {},
) {
	const sent: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	let active = options.active ?? true;
	const deps: WechatInteractionDeps = {
		peer: "alice@im.wechat",
		send: async (text) => {
			sent.push(text);
			return true;
		},
		sendFile: async (path, name) => {
			files.push({ path, name });
			return true;
		},
		active: () => active,
		language: () => options.language ?? "en",
		armTimer: options.timer,
		now: options.now,
	};
	const channel = createWechatInteractionChannel(deps);
	return { channel, sent, files, setActive: (value: boolean) => (active = value) };
}

describe("interaction channel", () => {
	test("post and postFile delegate to the bridge's senders", async () => {
		const { channel, sent, files } = setupChannel();
		await channel.post("hello");
		expect(sent).toEqual(["hello"]);
		expect(await channel.postFile("/tmp/plan.md", "plan.md")).toBe(true);
		expect(files).toEqual([{ path: "/tmp/plan.md", name: "plan.md" }]);
	});

	test("isActive follows whether this peer's turn runs", () => {
		const { channel, setActive } = setupChannel();
		expect(channel.isActive()).toBe(true);
		setActive(false);
		expect(channel.isActive()).toBe(false);
	});

	test("hasPending tracks whether a reply is awaited", async () => {
		const { channel } = setupChannel();
		expect(channel.hasPending()).toBe(false);
		const answer = channel.request(SELECT);
		expect(channel.hasPending()).toBe(true);
		channel.handleInbound("1");
		await answer;
		expect(channel.hasPending()).toBe(false);
	});

	test("pendingInfo exposes the peer, kind, title, and start time", async () => {
		const { channel } = setupChannel({ now: () => 1_000 });
		const answer = channel.request(SELECT);
		expect(channel.pendingInfo()).toEqual({
			peer: "alice@im.wechat",
			kind: "select",
			title: "Pick",
			startedAt: 1_000,
		});
		expect(channel.handleInbound("2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
		expect(channel.pendingInfo()).toBeUndefined();
	});

	test("cancels on demand, tells the peer once, and clears the prompt", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		channel.cancel();
		expect(await answer).toEqual({ kind: "cancelled" });
		// A withdrawal is not an expiry: the peer was not slow, the question left.
		expect(sent.at(-1)).toBe("That question was withdrawn.");
		expect(channel.hasPending()).toBe(false);
	});

	test("reset stays silent: it is cleanup, not a withdrawal", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent).toHaveLength(1);
	});

	test("sends the prompt and resolves on a matching reply", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(SELECT);
		expect(sent).toHaveLength(1);
		expect(channel.handleInbound("2")).toBe(true);
		expect(await answer).toEqual({ kind: "value", value: "B" });
	});

	test("cancels immediately when this peer has no running turn", async () => {
		const { channel } = setupChannel({ active: false });
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("cancels a concurrent second request", async () => {
		const { channel } = setupChannel();
		const first = channel.request(SELECT);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
		channel.handleInbound("1");
		await first;
	});

	test("cancels on abort", async () => {
		const { channel } = setupChannel();
		const controller = new AbortController();
		const answer = channel.request(SELECT, controller.signal);
		controller.abort();
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("cancels when the send fails", async () => {
		const deps: WechatInteractionDeps = {
			peer: "alice@im.wechat",
			send: async () => false,
			sendFile: async () => false,
			active: () => true,
			language: () => "en",
		};
		const channel = createWechatInteractionChannel(deps);
		expect(await channel.request(SELECT)).toEqual({ kind: "cancelled" });
	});

	test("reminds once and then cancels an unanswered prompt", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel({ timer: timers.arm });
		const answer = channel.request(CONFIRM);
		expect(sent).toHaveLength(1); // the prompt itself

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("Waiting for your reply");
		expect(channel.hasPending()).toBe(true);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("That question timed out.");
		expect(channel.hasPending()).toBe(false);
	});

	test("cancels the timeout timers once the peer answers", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel({ timer: timers.arm });
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("yes")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
		expect(timers.armed()).toBe(0);

		timers.fire(PROMPT_TIMEOUT_MS);
		expect(sent).toHaveLength(1);
	});

	test("speaks the peer's language in the timeout notices", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel({ timer: timers.arm, language: "zh" });
		const answer = channel.request(CONFIRM);

		timers.fire(PROMPT_TIMEOUT_MS / 2);
		expect(sent.at(-1)).toContain("等你回复");
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await answer).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("问题超时，已取消。");
	});

	test("honours a scoped bound and restores the default when it ends", async () => {
		const timers = timerSeam();
		const { channel, sent } = setupChannel({ timer: timers.arm });
		const restore = channel.setPromptTimeout(600_000);
		const answer = channel.request(CONFIRM);

		// The default bound is not in force while the scope is open.
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(channel.hasPending()).toBe(true);
		timers.fire(300_000);
		expect(sent.at(-1)).toContain("Waiting for your reply");
		timers.fire(600_000);
		expect(await answer).toEqual({ kind: "cancelled" });
		restore();

		const next = channel.request(CONFIRM);
		timers.fire(PROMPT_TIMEOUT_MS);
		expect(await next).toEqual({ kind: "cancelled" });
		expect(sent.at(-1)).toBe("That question timed out.");
	});

	test("handleInbound ignores an inbound message with no pending prompt", () => {
		const { channel } = setupChannel();
		expect(channel.handleInbound("hi")).toBe(false);
	});

	test("handleInbound re-prompts with a notice on a retry and keeps waiting", async () => {
		const { channel, sent } = setupChannel();
		const answer = channel.request(CONFIRM);
		expect(channel.handleInbound("maybe")).toBe(true);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toContain("didn't recognize");
		expect(channel.handleInbound("是")).toBe(true);
		expect(await answer).toEqual({ kind: "confirmed", confirmed: true });
	});

	test("handleInbound maps a cancel word to cancelled", async () => {
		const { channel } = setupChannel();
		const answer = channel.request(SELECT);
		channel.handleInbound("取消");
		expect(await answer).toEqual({ kind: "cancelled" });
	});

	test("a select free text becomes Other and the next input returns it", async () => {
		const { channel, sent } = setupChannel();
		const select = channel.request(SELECT);
		channel.handleInbound("custom value");
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		const before = sent.length;
		expect(await channel.request(INPUT)).toEqual({ kind: "value", value: "custom value" });
		expect(sent.length).toBe(before);
	});

	test("reset resolves a pending prompt as cancelled and clears the other stash", async () => {
		const { channel } = setupChannel();
		const answer = channel.request(SELECT);
		channel.reset();
		expect(await answer).toEqual({ kind: "cancelled" });

		const select = channel.request(SELECT);
		channel.handleInbound("custom value");
		await select;
		channel.reset();
		// The stash is gone, so the next input is a fresh prompt rather than a replay.
		const input = channel.request(INPUT);
		expect(channel.handleInbound("typed")).toBe(true);
		expect(await input).toEqual({ kind: "value", value: "typed" });
	});
});

/**
 * Free text from an "Other" answer belongs to the peer who typed it: one channel
 * serves one peer, so the stash has nowhere else to go. What remains to pin is
 * that it answers the very next input and does not outlive a different question.
 */
describe("other-answer ownership", () => {
	test("returns free text to the next input for this peer, without a round-trip", async () => {
		const { channel, sent } = setupChannel();
		const select = channel.request(SELECT);
		expect(channel.handleInbound("something else")).toBe(true);
		expect(await select).toEqual({ kind: "value", value: INTERACTION_OTHER_LABEL });

		expect(await channel.request(INPUT)).toEqual({ kind: "value", value: "something else" });
		// The stashed answer costs no prompt; only the one real prompt was sent.
		expect(sent).toHaveLength(1);
	});

	test("drops free text when a different kind of question is asked", async () => {
		const { channel } = setupChannel();
		const select = channel.request(SELECT);
		channel.handleInbound("something else");
		await select;

		const confirm = channel.request(CONFIRM);
		expect(channel.hasPending()).toBe(true);
		channel.handleInbound("yes");
		expect(await confirm).toEqual({ kind: "confirmed", confirmed: true });

		// The next input reads what the peer types now, not the abandoned "Other" text.
		const input = channel.request(INPUT);
		expect(channel.handleInbound("typed")).toBe(true);
		expect(await input).toEqual({ kind: "value", value: "typed" });
	});
});
