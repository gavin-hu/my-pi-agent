import { afterEach, describe, expect, jest, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import { registerCommands } from "./commands.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function setup(mode = "print") {
	const h = suite.makeHarness();
	const { pi, tools, commands } = createFakePi();
	registerTools(pi, h.runtime);
	registerCommands(pi, h.runtime);
	const { ctx } = makeCtx({ cwd: h.dir, mode });
	h.runtime.load(ctx);
	return { h, ctx, tool: tools.get(TOOL_NAME), command: commands.get("watch") };
}

/** Execute one `watch` tool call against the harness context. */
function call(tool: any, ctx: any, args: Record<string, unknown>) {
	return tool.execute("t", args, undefined, undefined, ctx);
}

describe("watch tool", () => {
	test("add returns the watcher id and details", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		const result = await call(tool, ctx, { action: "add", path, pattern: "error" });
		expect(result.isError).toBeUndefined();
		expect(result.details.action).toBe("add");
		expect(result.details.watch.id).toBe("w1");
	});

	test("an add result reads one way for every flag combination", async () => {
		const { ctx, tool } = setup();
		const lines: string[] = [];
		for (const flags of [{}, { caseSensitive: true }, { wake: true }, { caseSensitive: true, wake: true }]) {
			const result = await call(tool, ctx, { action: "add", command: "build", pattern: "FAIL", ...flags });
			expect(result.isError).toBeUndefined();
			lines.push(result.content[0].text.split("\n")[0]);
		}
		expect(lines).toEqual([
			"Watching w1: $ build → /FAIL/i",
			"Watching w2: $ build → /FAIL/",
			"Watching w3: $ build → /FAIL/i · wake",
			"Watching w4: $ build → /FAIL/ · wake",
		]);
	});

	test("a rejected add returns an error without state", async () => {
		const { ctx, tool } = setup();
		const result = await call(tool, ctx, { action: "add", pattern: "error" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/requires a path or a command/);
	});

	test("list reports the watchers", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		await call(tool, ctx, { action: "add", path, pattern: "a" });
		const result = await call(tool, ctx, { action: "list" });
		expect(result.details.watches).toHaveLength(1);
		expect(result.content[0].text).toContain("w1");
	});

	test("status reports an unknown id as an error", async () => {
		const { ctx, tool } = setup();
		const result = await call(tool, ctx, { action: "status", id: "w9" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/no watcher/);
	});

	test("matches returns appended matches after a tick", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		await call(tool, ctx, { action: "add", path, pattern: "error" });
		appendFileSync(path, "error: boom\n");
		h.runtime.tick();
		const result = await call(tool, ctx, { action: "matches", id: "w1" });
		expect(result.details.matches).toBe("error: boom");
	});

	test("logs returns the raw output tail", async () => {
		const { h, ctx, tool } = setup();
		await call(tool, ctx, { action: "add", command: "build", pattern: "FAIL" });
		h.children[0].write("ok\nFAIL: one\n");
		const result = await call(tool, ctx, { action: "logs", id: "w1" });
		expect(result.details.logs).toBe("ok\nFAIL: one");
	});

	test("stop and clear manage watchers", async () => {
		const { ctx, tool } = setup();
		await call(tool, ctx, { action: "add", command: "build", pattern: "x" });
		const stopped = await call(tool, ctx, { action: "stop", id: "w1" });
		expect(stopped.details.stopped).toBe(true);
		const cleared = await call(tool, ctx, { action: "clear" });
		expect(cleared.details.cleared).toBe(1);
	});

	test("status and list name the signal that killed a command", async () => {
		const { h, ctx, tool } = setup();
		await call(tool, ctx, { action: "add", command: "build", pattern: "x" });
		// Node's own account of a killed child: no exit code, and the signal that ended it.
		h.children[0].close(null, "SIGKILL");
		const status = await call(tool, ctx, { action: "status", id: "w1" });
		expect(status.content[0].text.split("\n")[0]).toBe("w1: exited (SIGKILL)");
		const list = await call(tool, ctx, { action: "list" });
		expect(list.content[0].text).toContain("w1  exited (SIGKILL)");
	});

	test("clear refuses a running watcher by id without all", async () => {
		const { ctx, tool } = setup();
		await call(tool, ctx, { action: "add", command: "build", pattern: "x" });
		const result = await call(tool, ctx, { action: "clear", id: "w1" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/is running/);
	});
});

describe("watch transcript result", () => {
	test("list renders a themed rail with a cap note", () => {
		const { tool } = setup();
		const watches = Array.from({ length: 10 }, (_, i) => ({
			id: `w${i + 1}`,
			label: `watcher ${i + 1}`,
			source: { kind: "file" as const, path: "/tmp/x.log" },
			pattern: "x",
			exclude: [],
			caseSensitive: false,
			wake: false,
			fromStart: false,
			status: "running" as const,
			startedAt: 0,
			linesRead: 0,
			matchCount: 0,
		}));
		const result = { content: [{ type: "text", text: "model" }], details: { action: "list", watches } };
		const lines = tool
			.renderResult(result, { expanded: false, isPartial: false }, fakeTheme, { lastComponent: undefined })
			.render(80);
		expect(lines.some((line: string) => line.includes("w1"))).toBe(true);
		expect(lines.at(-1)).toContain("2 more");
	});

	test("an add result names the watcher and its badges", () => {
		const { tool } = setup();
		const watch = {
			id: "w1",
			label: "ci",
			source: { kind: "file" as const, path: "/tmp/x.log" },
			pattern: "x",
			exclude: [],
			caseSensitive: false,
			wake: true,
			fromStart: true,
			status: "running" as const,
			startedAt: 0,
			linesRead: 0,
			matchCount: 0,
		};
		const result = { content: [{ type: "text", text: "model" }], details: { action: "add", watch } };
		const text = tool
			.renderResult(result, { expanded: false, isPartial: false }, fakeTheme, { lastComponent: undefined })
			.render(80)
			.join("\n");
		expect(text).toContain("w1");
		expect(text).toContain("wake");
		expect(text).toContain("from start");
	});
});

describe("watch command completions", () => {
	test("completes subcommands by prefix", () => {
		const { command } = setup();
		const values = (command.getArgumentCompletions("ma") ?? []).map((item: { value: string }) => item.value);
		expect(values).toEqual(["matches "]);
	});

	test("completes a watcher id after matches", () => {
		const { h, ctx, command } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		h.runtime.add({ path, pattern: "x", label: "app errors" }, ctx);
		const values = (command.getArgumentCompletions("matches w") ?? []).map((item: { value: string }) => item.value);
		expect(values).toEqual(["w1"]);
	});
});

describe("watch command handler outside the TUI", () => {
	test("lists watchers", async () => {
		const { h, ctx, command } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		h.runtime.add({ path, pattern: "x" }, ctx);
		await command.handler("list", ctx);
		expect(ctx.notices.at(-1)?.message).toContain("Watchers (1)");
	});

	test("warns when matches has no id", async () => {
		const { ctx, command } = setup();
		await command.handler("matches", ctx);
		expect(ctx.notices.at(-1)?.message).toBe("/watch matches <id>");
	});

	test("reports an unknown id as an error", async () => {
		const { ctx, command } = setup();
		await command.handler("matches w9", ctx);
		expect(ctx.notices.at(-1)).toEqual({ message: 'no watcher "w9".', kind: "error" });
	});

	test("shows the logged tail", async () => {
		const { h, ctx, command } = setup();
		h.runtime.add({ command: "build", pattern: "FAIL" }, ctx);
		h.children[0].write("ok\nFAIL: one\n");
		await command.handler("logs w1", ctx);
		expect(ctx.notices.at(-1)?.message).toBe("ok\nFAIL: one");
	});

	test("stops a watcher by id", async () => {
		const { h, ctx, command } = setup();
		h.runtime.add({ command: "build", pattern: "x" }, ctx);
		await command.handler("stop w1", ctx);
		expect(ctx.notices.at(-1)?.message).toBe("Stopped w1.");
	});

	test("clears stopped watchers with all", async () => {
		const { h, ctx, command } = setup();
		h.runtime.add({ command: "build", pattern: "x" }, ctx);
		h.runtime.stop("w1");
		await command.handler("clear all", ctx);
		expect(ctx.notices.at(-1)?.message).toBe("Cleared 1.");
	});
});

describe("watch command screen", () => {
	test("the refresh timer does not poll the runtime", async () => {
		const { h, ctx, command } = setup("tui");
		let ticks = 0;
		h.runtime.tick = () => {
			ticks++;
		};

		await command.handler("", ctx);
		const factory = ctx.customCalls.at(-1);
		expect(typeof factory).toBe("function");

		jest.useFakeTimers();
		try {
			const component = factory({ requestRender: () => {}, terminal: { rows: 24 } }, fakeTheme, {}, () => {});
			jest.advanceTimersByTime(5000);
			expect(ticks).toBe(0);
			component.handleInput("q");
		} finally {
			jest.useRealTimers();
		}
	});
});
