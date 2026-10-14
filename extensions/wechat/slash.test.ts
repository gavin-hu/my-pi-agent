import { describe, expect, test } from "bun:test";
import {
	expandSnippet,
	findSlashCommand,
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
});
