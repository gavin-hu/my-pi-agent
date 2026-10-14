import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import { registerTools, TOOL_NAME } from "./tools.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function setup() {
	const h = suite.makeHarness();
	const { pi, tools } = createFakePi();
	registerTools(pi, h.runtime);
	const { ctx } = makeCtx({ cwd: h.dir });
	h.runtime.load(ctx);
	const tool = tools.get(TOOL_NAME);
	return { h, ctx, tool };
}

describe("watch tool", () => {
	test("add returns the watcher id and details", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		const result = await tool.execute("t", { action: "add", path, pattern: "error" }, undefined, undefined, ctx);
		expect(result.isError).toBeUndefined();
		expect(result.details.action).toBe("add");
		expect(result.details.watch.id).toBe("w1");
	});

	test("a rejected add returns an error without state", async () => {
		const { tool, ctx } = setup();
		const result = await tool.execute("t", { action: "add", pattern: "error" }, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/requires a path or a command/);
	});

	test("list reports the watchers", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		await tool.execute("t", { action: "add", path, pattern: "a" }, undefined, undefined, ctx);
		const result = await tool.execute("t", { action: "list" }, undefined, undefined, ctx);
		expect(result.details.watches).toHaveLength(1);
		expect(result.content[0].text).toContain("w1");
	});

	test("status reports an unknown id as an error", async () => {
		const { tool, ctx } = setup();
		const result = await tool.execute("t", { action: "status", id: "w9" }, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.details.error).toMatch(/no watcher/);
	});

	test("matches returns appended matches after a tick", async () => {
		const { h, ctx, tool } = setup();
		const path = join(h.dir, "app.log");
		writeFileSync(path, "");
		await tool.execute("t", { action: "add", path, pattern: "error" }, undefined, undefined, ctx);
		appendFileSync(path, "error: boom\n");
		h.runtime.tick();
		const result = await tool.execute("t", { action: "matches", id: "w1" }, undefined, undefined, ctx);
		expect(result.details.matches).toBe("error: boom");
	});

	test("stop and clear manage watchers", async () => {
		const { ctx, tool } = setup();
		await tool.execute("t", { action: "add", command: "build", pattern: "x" }, undefined, undefined, ctx);
		const stopped = await tool.execute("t", { action: "stop", id: "w1" }, undefined, undefined, ctx);
		expect(stopped.details.stopped).toBe(true);
		const cleared = await tool.execute("t", { action: "clear" }, undefined, undefined, ctx);
		expect(cleared.details.cleared).toBe(1);
	});
});

describe("watch transcript rendering", () => {
	test("call line reuses the slot Text", () => {
		const { tool } = setup();
		const first = tool.renderCall({ action: "add", path: "app.log", pattern: "error" }, fakeTheme, {
			argsComplete: true,
			lastComponent: undefined,
		});
		const second = tool.renderCall({ action: "add", path: "app.log", pattern: "error" }, fakeTheme, {
			argsComplete: true,
			lastComponent: first,
		});
		expect(second).toBe(first);
		expect(first.render(80).join("\n")).toContain("watch add app.log /error/");
	});

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
		expect(lines[0]).toBe("");
		expect(lines.some((line: string) => line.includes("w1"))).toBe(true);
		expect(lines.at(-1)).toContain("2 more");
	});
});
