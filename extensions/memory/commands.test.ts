import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memorySuite, type MemorySuite } from "../../test/helpers/fixtures/memory.ts";
import { TOOL_NAME } from "./tools.ts";

let suite: MemorySuite;

beforeEach(() => {
	suite = memorySuite();
});

afterEach(() => {
	suite.dispose();
});

describe("memory commands", () => {
	test("/memory reports the store outside the TUI", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await suite.command().handler("", { ...suite.ctx, mode: "print" });
		expect(suite.notices.at(-1)).toContain("one");
	});

	test("bare /memory opens the picker in the TUI", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await suite.command().handler("", suite.ctx);
		expect(suite.ctx.customCalls).toHaveLength(1);
	});

	test("/memory list is recognized and reports the store", async () => {
		suite.write("project", "- repo note\n");
		suite.write("global", "- global note\n");
		await suite.start();
		await suite.command().handler("list", suite.ctx);
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain("repo note");
		expect(last).toContain("global note");
	});

	test("/memory warns on an unknown subcommand instead of listing", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		await suite.command().handler("bogus", suite.ctx);
		const notice = suite.ctx.notices.at(-1);
		expect(notice.message).toContain("Unknown /memory subcommand");
		expect(notice.kind).toBe("warning");
	});

	test("/memory path reports the resolved files and trust", async () => {
		await suite.start();
		await suite.command().handler("path", suite.ctx);
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain(suite.projectPath);
		expect(last).toContain(suite.globalPath);
	});

	test("/memory reload reports an external change", async () => {
		await suite.start();

		suite.write("global", "- external global\n");
		await suite.command().handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toMatch(/Reloaded global memory/);
	});

	test("a self-write is not reported by /memory reload", async () => {
		await suite.start();

		await suite.pi.tools.get(TOOL_NAME)?.execute("call", { action: "add", text: "mine" }, undefined, undefined);
		await suite.command().handler("reload", suite.ctx);
		expect(suite.notices.at(-1)).toBe("Memory is already up to date.");
	});

	test("/memory doctor reports counts, the injection budget, and duplicates", async () => {
		suite.write("project", "- Use bun\n- use bun.\n");
		suite.write("global", "- global note\n");
		await suite.start();

		await suite.command().handler("doctor", suite.ctx);

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

		await suite.command().handler("doctor", suite.ctx);

		expect(suite.notices.at(-1)).toMatch(/omitted \(global \d+\)/);
	});

	test("/memory doctor works without a store and in a non-TUI mode", async () => {
		await suite.start();
		await suite.command().handler("doctor", { ...suite.ctx, mode: "print" });
		const last = suite.notices.at(-1) ?? "";
		expect(last).toContain("Memory health");
		expect(last).toContain("nothing to inject");
	});

	test("/memory edit saves the edited text", async () => {
		await suite.start();
		suite.ctx.ui.editor = async () => "# manual\n- written by hand\n";

		await suite.command().handler("edit global", suite.ctx);

		expect(suite.read("global")).toContain("- written by hand");
		expect(suite.notices.at(-1)).toContain("Saved global memory");
	});

	test("/memory clear empties a store after confirmation", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		suite.setConfirm(true);
		await suite.command().handler("clear global", suite.ctx);
		expect(suite.read("global")).not.toContain("- one");
	});

	test("/memory clear keeps the store when the confirmation is declined", async () => {
		suite.write("global", "- one\n");
		await suite.start();
		suite.setConfirm(false);
		await suite.command().handler("clear global", suite.ctx);
		expect(suite.read("global")).toContain("- one");
	});
});
