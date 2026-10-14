import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { fakeTheme, makeFakePi } from "../../test/helpers/fakes.ts";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import memory from "./index.ts";
import { MAX_MEMORY_BYTES } from "./store.ts";
import { TOOL_NAME } from "./tools.ts";

let suite: MemorySuite;

beforeEach(() => {
	suite = memorySuite();
});

afterEach(() => {
	suite.dispose();
});

function tool() {
	return suite.pi.tools.get(TOOL_NAME);
}

describe("memory extension", () => {
	test("renderResult sanitizes a rejected call's error text", () => {
		const result = {
			content: [{ type: "text", text: "" }],
			details: { action: "list", project: [], global: [], error: "bad\u001b[31mtext" },
		};
		const text = tool()
			.renderResult(result, { expanded: false, isPartial: false }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("bad");
		expect(text).not.toContain("\u001b");
	});

	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "memory" }, () => {
			const { pi, tools, commands, handlers } = makeFakePi();
			memory(pi);
			expect(tools.size).toBe(0);
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the memory tool and /memory command", () => {
		expect(suite.pi.tools.has(TOOL_NAME)).toBe(true);
		expect(suite.pi.commands.has("memory")).toBe(true);
	});

	test("completes memory subcommands and edit/clear scopes", () => {
		const complete = (prefix: string): string[] =>
			(suite.pi.commands.get("memory").getArgumentCompletions(prefix) ?? []).map(
				(item: { label: string }) => item.label,
			);
		expect(complete("")).toEqual(["list", "path", "reload", "edit", "clear"]);
		expect(complete("edit ")).toEqual(["project", "global"]);
		expect(complete("clear g")).toEqual(["global"]);
	});

	test("injects stored notes before a run", async () => {
		suite.write("project", "- repo fact\n");
		suite.write("global", "- global fact\n");
		await suite.start();

		const [result] = await suite.emit("before_agent_start", {});
		expect(result.message.content).toContain("[MEMORY]");
		expect(result.message.content).toContain("- repo fact");
		expect(result.message.content).toContain("- global fact");
		expect(result.message.display).toBe(false);
	});

	test("injects nothing when no notes are stored", async () => {
		await suite.start();
		const [result] = await suite.emit("before_agent_start", {});
		expect(result).toBeUndefined();
	});

	test("drops project notes and rejects project writes for an untrusted project", async () => {
		suite.setTrusted(false);
		suite.write("project", "- secret\n");
		suite.write("global", "- global fact\n");
		await suite.start();

		const [injected] = await suite.emit("before_agent_start", {});
		expect(injected.message.content).not.toContain("- secret");
		expect(injected.message.content).toContain("- global fact");

		const result = await tool().execute("1", { action: "add", text: "x", scope: "project" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/untrusted/);
	});

	test("keeps only the newest injected memory message", async () => {
		await suite.start();
		const first = { role: "custom", customType: "memory-context", content: "old", display: false };
		const second = { role: "custom", customType: "memory-context", content: "new", display: false };
		const other = { role: "user", content: "hi" };

		const [result] = await suite.emit("context", { messages: [first, other, second] });
		expect(result.messages).toEqual([other, second]);
	});

	test("adds, lists, and forgets a note through the tool", async () => {
		await suite.start();

		const added = await tool().execute("1", { action: "add", text: "remember me" }, undefined, undefined);
		expect(added.details.changed).toBe(true);
		expect(added.details.project).toContain("remember me");
		expect(suite.read("project")).toContain("- remember me");

		const listed = await tool().execute("2", { action: "list" }, undefined, undefined);
		expect(listed.details.project).toContain("remember me");

		const forgotten = await tool().execute("3", { action: "forget", text: "remember me" }, undefined, undefined);
		expect(forgotten.details.changed).toBe(true);
		expect(suite.read("project")).not.toContain("- remember me");
	});

	test("a forget that matches nothing is an error carrying the unchanged notes", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		const result = await tool().execute("1", { action: "forget", text: "absent" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/No project memory note matches/);
		expect(result.details.project).toContain("keep");
	});

	test("a reworded add is a no-op that names the stored note", async () => {
		suite.write("project", "- Use tabs\n");
		await suite.start();

		const result = await tool().execute("1", { action: "add", text: "use tabs." }, undefined, undefined);
		expect(result.isError).toBeUndefined();
		expect(result.details.changed).toBe(false);
		expect(result.details.existing).toBe("Use tabs");
		expect(result.structuredContent.existing).toBe("Use tabs");
		expect(suite.read("project")).toBe("- Use tabs\n");
	});

	test("/memory reports the store", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await suite.pi.commands.get("memory").handler("", suite.ctx);
		expect(suite.notices.at(-1)).toContain("one");
	});

	test("/memory path reports the resolved files and trust", async () => {
		await suite.start();
		await suite.pi.commands.get("memory").handler("path", suite.ctx);
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain(suite.projectPath);
		expect(last).toContain(suite.globalPath);
	});

	test("/memory clear empties a store after confirmation", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		suite.setConfirm(true);
		await suite.pi.commands.get("memory").handler("clear global", suite.ctx);
		expect(suite.read("global")).not.toContain("- one");
	});

	test("picks up an external edit before the next run", async () => {
		suite.write("project", "- old fact\n");
		await suite.start();

		suite.write("project", "- a fresh external fact\n");
		const [result] = await suite.emit("before_agent_start", {});
		expect(result.message.content).toContain("- a fresh external fact");
		expect(result.message.content).not.toContain("- old fact");
	});

	test("picks up an external edit through the tool", async () => {
		await suite.start();

		suite.write("project", "- external list fact\n");
		const listed = await tool().execute("1", { action: "list" }, undefined, undefined);
		expect(listed.details.project).toContain("external list fact");
	});

	test("picks up a same-size external edit when the mtime advances", async () => {
		suite.write("project", "- a\n");
		await suite.start();

		suite.write("project", "- b\n");
		// Jump the mtime far from the loaded stamp without the wall clock: utimesSync
		// treats a number as seconds since the epoch.
		utimesSync(suite.projectPath, 1_000, 1_000);
		const [result] = await suite.emit("before_agent_start", {});
		expect(result.message.content).toContain("- b");
	});

	test("a self-write is not reported by /memory reload", async () => {
		await suite.start();

		await tool().execute("1", { action: "add", text: "mine" }, undefined, undefined);
		await suite.pi.commands.get("memory").handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toBe("Memory is already up to date.");
	});

	test("/memory reload reports an external change", async () => {
		await suite.start();

		suite.write("global", "- external global\n");
		await suite.pi.commands.get("memory").handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toMatch(/Reloaded global memory/);
	});

	test("an unreadable external file keeps the last good view", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		suite.write("project", "a".repeat(MAX_MEMORY_BYTES + 1));
		const [result] = await suite.emit("before_agent_start", {});
		expect(result.message.content).toContain("- keep");
	});

	test("updates a note through the tool", async () => {
		await suite.start();
		await tool().execute("1", { action: "add", text: "old note" }, undefined, undefined);

		const updated = await tool().execute(
			"2",
			{ action: "update", text: "old note", to: "new note" },
			undefined,
			undefined,
		);
		expect(updated.details.changed).toBe(true);
		expect(updated.details.to).toBe("new note");
		expect(suite.read("project")).toContain("- new note");
		expect(suite.read("project")).not.toContain("- old note");
	});

	test("a non-matching update is an error carrying the unchanged notes", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		const result = await tool().execute("1", { action: "update", text: "absent", to: "x" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/No project memory note matches/);
		expect(result.details.project).toContain("keep");
	});

	test("updating a note to itself is a success no-op", async () => {
		await suite.start();
		await tool().execute("1", { action: "add", text: "same" }, undefined, undefined);

		const result = await tool().execute("2", { action: "update", text: "same", to: "same" }, undefined, undefined);
		expect(result.isError).toBeUndefined();
		expect(result.details.changed).toBe(false);
		expect(suite.read("project")).toContain("- same");
	});

	test("rejects a project update for an untrusted project", async () => {
		suite.setTrusted(false);
		await suite.start();

		const result = await tool().execute("1", { action: "update", text: "a", to: "b" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/untrusted/);
	});
});
