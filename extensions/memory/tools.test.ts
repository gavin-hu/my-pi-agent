import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import memory from "./index.ts";
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

function command() {
	return suite.pi.commands.get("memory");
}

function execute(args: Record<string, unknown>) {
	return tool().execute("call", args, undefined, undefined);
}

describe("memory registration", () => {
	test("registers the memory tool and /memory command", () => {
		expect(suite.pi.tools.has(TOOL_NAME)).toBe(true);
		expect(suite.pi.commands.has("memory")).toBe(true);
	});

	test("registers the tool with its contract annotations", () => {
		const memoryTool = tool();
		expect(memoryTool.label).toBe("Memory");
		expect(memoryTool.executionMode).toBe("sequential");
		expect(memoryTool.annotations).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: false,
		});
		expect(memoryTool.promptSnippet).toBeTruthy();
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

	test("completes memory subcommands and edit/clear scopes", () => {
		const complete = (prefix: string): string[] =>
			(command().getArgumentCompletions(prefix) ?? []).map((item: { label: string }) => item.label);
		expect(complete("")).toEqual(["list", "path", "reload", "doctor", "edit", "clear"]);
		expect(complete("edit ")).toEqual(["project", "global"]);
		expect(complete("clear g")).toEqual(["global"]);
	});
});

describe("memory context lifecycle", () => {
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

	test("injects nothing when recall is disabled in config", async () => {
		suite.write("global", "- global fact\n");
		mkdirSync(join(suite.cwd, ".pi"), { recursive: true });
		writeFileSync(join(suite.cwd, ".pi", "bytefly.json"), JSON.stringify({ memory: { inject: false } }));
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

		const result = await execute({ action: "add", text: "x", scope: "project" });
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

	test("picks up an external edit before the next run", async () => {
		suite.write("project", "- old fact\n");
		await suite.start();

		suite.write("project", "- a fresh external fact\n");
		const [result] = await suite.emit("before_agent_start", {});
		expect(result.message.content).toContain("- a fresh external fact");
		expect(result.message.content).not.toContain("- old fact");
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

	test("picks up an external edit through the tool", async () => {
		await suite.start();

		suite.write("project", "- external list fact\n");
		const listed = await execute({ action: "list" });
		expect(listed.details.project).toContain("external list fact");
	});

	test("session_shutdown drops the session view", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await suite.emit("session_shutdown", {});

		const [injected] = await suite.emit("before_agent_start", {});
		expect(injected).toBeUndefined();

		await command().handler("path", suite.ctx);
		expect(suite.notices.at(-1)).toContain("not initialized");
	});
});

describe("memory tool actions", () => {
	test("adds, lists, and forgets a note through the tool", async () => {
		await suite.start();

		const added = await execute({ action: "add", text: "remember me" });
		expect(added.details.changed).toBe(true);
		expect(added.details.project).toContain("remember me");
		expect(suite.read("project")).toContain("- remember me");

		const listed = await execute({ action: "list" });
		expect(listed.details.project).toContain("remember me");

		const forgotten = await execute({ action: "forget", text: "remember me" });
		expect(forgotten.details.changed).toBe(true);
		expect(suite.read("project")).not.toContain("- remember me");
	});

	test("a reworded add is a no-op that names the stored note", async () => {
		suite.write("project", "- Use tabs\n");
		await suite.start();

		const result = await execute({ action: "add", text: "use tabs." });
		expect(result.isError).toBeUndefined();
		expect(result.details.changed).toBe(false);
		expect(result.details.existing).toBe("Use tabs");
		expect(result.structuredContent.existing).toBe("Use tabs");
		expect(suite.read("project")).toBe("- Use tabs\n");
	});

	test("a forget that matches nothing is an error carrying the unchanged notes", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		const result = await execute({ action: "forget", text: "absent" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/No project memory note matches/);
		expect(result.details.project).toContain("keep");
		expect(result.structuredContent.error).toBe(result.details.error);
	});

	test("updates a note through the tool", async () => {
		await suite.start();
		await execute({ action: "add", text: "old note" });

		const updated = await execute({ action: "update", text: "old note", to: "new note" });
		expect(updated.details.changed).toBe(true);
		expect(updated.details.to).toBe("new note");
		expect(suite.read("project")).toContain("- new note");
		expect(suite.read("project")).not.toContain("- old note");
	});

	test("a non-matching update is an error carrying the unchanged notes", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		const result = await execute({ action: "update", text: "absent", to: "x" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/No project memory note matches/);
		expect(result.details.project).toContain("keep");
	});

	test("updating a note to itself is a success no-op", async () => {
		await suite.start();
		await execute({ action: "add", text: "same" });

		const result = await execute({ action: "update", text: "same", to: "same" });
		expect(result.isError).toBeUndefined();
		expect(result.details.changed).toBe(false);
		expect(suite.read("project")).toContain("- same");
	});

	test("rejects a project update for an untrusted project", async () => {
		suite.setTrusted(false);
		await suite.start();

		const result = await execute({ action: "update", text: "a", to: "b" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/untrusted/);
	});

	test("rejects an unknown action or scope with an error result carrying the notes", async () => {
		suite.write("project", "- keep\n");
		await suite.start();

		const badAction = await execute({ action: "delete" });
		expect(badAction.isError).toBe(true);
		expect(badAction.details.error).toMatch(/action must be/);
		expect(badAction.details.project).toContain("keep");

		const badScope = await execute({ action: "list", scope: "team" });
		expect(badScope.isError).toBe(true);
		expect(badScope.details.error).toMatch(/scope must be/);
		expect(badScope.structuredContent.error).toBe(badScope.details.error);
	});

	test("rejects a blank note before creating the store", async () => {
		await suite.start();

		const result = await execute({ action: "add", text: "   " });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/text is required/);
		expect(suite.exists("project")).toBe(false);
	});
});

describe("memory commands", () => {
	test("/memory reports the store outside the TUI", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await command().handler("", { ...suite.ctx, mode: "print" });
		expect(suite.notices.at(-1)).toContain("one");
	});

	test("bare /memory opens the picker in the TUI", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await command().handler("", suite.ctx);
		expect(suite.ctx.customCalls).toHaveLength(1);
	});

	test("/memory list is recognized and reports the store", async () => {
		suite.write("project", "- repo note\n");
		suite.write("global", "- global note\n");
		await suite.start();
		await command().handler("list", suite.ctx);
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain("repo note");
		expect(last).toContain("global note");
	});

	test("/memory warns on an unknown subcommand instead of listing", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await command().handler("bogus", suite.ctx);
		const notice = suite.ctx.notices.at(-1);
		expect(notice.message).toContain("Unknown /memory subcommand");
		expect(notice.kind).toBe("warning");
	});

	test("/memory path reports the resolved files and trust", async () => {
		await suite.start();
		await command().handler("path", suite.ctx);
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain(suite.projectPath);
		expect(last).toContain(suite.globalPath);
	});

	test("/memory reload reports an external change", async () => {
		await suite.start();

		suite.write("global", "- external global\n");
		await command().handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toMatch(/Reloaded global memory/);
	});

	test("a self-write is not reported by /memory reload", async () => {
		await suite.start();

		await execute({ action: "add", text: "mine" });
		await command().handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toBe("Memory is already up to date.");
	});

	test("/memory doctor reports counts, the injection budget, and duplicates", async () => {
		suite.write("project", "- Use bun\n- use bun.\n");
		suite.write("global", "- global note\n");
		await suite.start();

		await command().handler("doctor", suite.ctx);

		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain("Memory health");
		expect(last).toMatch(/project\s+2 notes/);
		expect(last).toMatch(/global\s+1 note/);
		expect(last).toContain("all notes fit");
		expect(last).toContain("1 pair");
		expect(last).toContain('"Use bun"');
	});

	test("/memory doctor names the notes the cap drops", async () => {
		const notes = Array.from({ length: 40 }, (_, index) => `- note ${index} ${"x".repeat(40)}`);
		suite.write("global", `${notes.join("\n")}\n`);
		mkdirSync(join(suite.cwd, ".pi"), { recursive: true });
		writeFileSync(join(suite.cwd, ".pi", "bytefly.json"), JSON.stringify({ memory: { maxInjectBytes: 512 } }));
		await suite.start();

		await command().handler("doctor", suite.ctx);

		expect(suite.notices.at(-1)).toMatch(/omitted \(global \d+\)/);
	});

	test("/memory doctor works without a store and in a non-TUI mode", async () => {
		await suite.start();
		await command().handler("doctor", { ...suite.ctx, mode: "print" });
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain("Memory health");
		expect(last).toContain("nothing to inject");
	});

	test("/memory edit saves the edited text", async () => {
		await suite.start();
		suite.ctx.ui.editor = async () => "# manual\n- written by hand\n";

		await command().handler("edit global", suite.ctx);

		expect(suite.read("global")).toContain("- written by hand");
		expect(suite.notices.at(-1)).toContain("Saved global memory");
	});

	test("/memory clear empties a store after confirmation", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		suite.setConfirm(true);
		await command().handler("clear global", suite.ctx);
		expect(suite.read("global")).not.toContain("- one");
	});

	test("/memory clear keeps the store when the confirmation is declined", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		suite.setConfirm(false);
		await command().handler("clear global", suite.ctx);
		expect(suite.read("global")).toContain("- one");
	});
});
