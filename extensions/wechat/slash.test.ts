import { describe, expect, test } from "bun:test";
import {
	expandSnippet,
	findSlashCommand,
	helpText,
	parseSlash,
	SLASH_COMMANDS,
	type SlashCommand,
	type SlashContext,
} from "./slash.ts";

const snippet: SlashCommand = {
	name: "summarize",
	summary: "Summarize the current context",
	kind: "snippet",
	snippet: "Summarize what we have so far.",
};

describe("parseSlash", () => {
	test("parses a bare command", () => {
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
});

describe("findSlashCommand", () => {
	test("matches case-insensitively and ignores unknown names", () => {
		expect(findSlashCommand(SLASH_COMMANDS, "NEW")?.name).toBe("new");
		expect(findSlashCommand(SLASH_COMMANDS, "nope")).toBeUndefined();
		// A path-like message parses to a name that is not registered.
		expect(findSlashCommand(SLASH_COMMANDS, parseSlash("/usr/local")?.name ?? "")).toBeUndefined();
	});
});

describe("expandSnippet", () => {
	test("returns the body alone without args", () => {
		expect(expandSnippet(snippet, "")).toBe("Summarize what we have so far.");
	});

	test("appends args as a separate paragraph", () => {
		expect(expandSnippet(snippet, "about the tests")).toBe("Summarize what we have so far.\n\nabout the tests");
	});

	test("handles a bodyless snippet", () => {
		expect(expandSnippet({ name: "x", summary: "", kind: "snippet" }, "only args")).toBe("only args");
	});
});

describe("built-in /new", () => {
	test("is an owner-only action", () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		expect(command?.kind).toBe("action");
		expect(command?.ownerOnly).toBe(true);
	});

	test("replies before starting the session", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		const events: string[] = [];
		const ctx = {
			args: "",
			peer: "owner@im.wechat",
			reply: async (text: string) => {
				events.push(`reply:${text}`);
			},
			activeTurn: false,
			language: "en",
			session: {
				newSession: () => {
					events.push("newSession");
				},
			},
		} satisfies SlashContext;
		await command?.run?.(ctx);
		expect(events[0]).toContain("reply:Starting a new session");
		expect(events[1]).toBe("newSession");
	});

	test("declines while a turn is in flight instead of restarting", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		const events: string[] = [];
		await command?.run?.({
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				events.push(`reply:${text}`);
			},
			activeTurn: true,
			language: "en",
			session: { newSession: () => events.push("newSession") },
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toContain("Still working on your last message");
	});

	test("answers a Chinese peer in Chinese", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "new");
		let reply = "";
		await command?.run?.({
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				reply = text;
			},
			activeTurn: true,
			language: "zh",
			session: { newSession: () => {} },
		});
		expect(reply).toBe("正在处理当前消息，稍后再发送 /new。");
	});
});

describe("built-in /help", () => {
	test("is a non-owner action", () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		expect(command?.kind).toBe("action");
		expect(command?.ownerOnly).toBeUndefined();
	});

	test("replies with the command list", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		let reply = "";
		await command?.run?.({
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				reply = text;
			},
			activeTurn: false,
			language: "en",
			session: { newSession: () => {} },
		} satisfies SlashContext);
		expect(reply).toContain("/new");
		expect(reply).toContain("/help");
		expect(reply).toContain("owner only");
	});

	test("replies in Chinese for a Chinese peer", async () => {
		const command = findSlashCommand(SLASH_COMMANDS, "help");
		let reply = "";
		await command?.run?.({
			args: "",
			peer: "owner@im.wechat",
			reply: async (text) => {
				reply = text;
			},
			activeTurn: false,
			language: "zh",
			session: { newSession: () => {} },
		});
		expect(reply).toContain("可用命令：");
		expect(reply).toContain("/new — 开始新会话（仅限所有者）");
		expect(reply).not.toContain("owner only");
	});
});

describe("helpText", () => {
	test("lists each command and marks owner-only ones", () => {
		const text = helpText([
			{ name: "new", summary: "Start a new session", kind: "action", ownerOnly: true },
			{ name: "help", summary: "List the chat commands", kind: "action" },
		]);
		expect(text).toContain("/new — Start a new session (owner only)");
		expect(text).toContain("/help — List the chat commands");
		expect(text).toContain("reaches the agent");
	});

	test("speaks Chinese when the peer does", () => {
		const text = helpText(
			[
				{ name: "new", summary: "Start a new session", summaryZh: "开始新会话", kind: "action", ownerOnly: true },
				{ name: "help", summary: "List the chat commands", kind: "action" },
			],
			"zh",
		);
		expect(text).toContain("/new — 开始新会话（仅限所有者）");
		// A command without a Chinese summary falls back to the English one.
		expect(text).toContain("/help — List the chat commands");
		expect(text).toContain("其他内容都会发送给助手。");
	});
});
