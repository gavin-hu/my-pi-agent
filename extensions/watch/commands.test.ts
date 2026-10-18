import { afterEach, describe, expect, jest, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import { makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/watch.ts";
import { registerCommands } from "./commands.ts";

const suite = makeHarnessSuite();
afterEach(() => suite.cleanup());

function setup() {
	const h = suite.makeHarness();
	const { pi, commands } = createFakePi();
	registerCommands(pi, h.runtime);
	const { ctx } = makeCtx({ cwd: h.dir });
	h.runtime.load(ctx);
	const command = commands.get("watch");
	return { h, ctx, command };
}

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

	test("stops a watcher by id", async () => {
		const { h, ctx, command } = setup();
		h.runtime.add({ command: "build", pattern: "x" }, ctx);
		await command.handler("stop w1", ctx);
		expect(ctx.notices.at(-1)?.message).toBe("Stopped w1.");
	});
});

describe("watch command screen", () => {
	test("the refresh timer does not poll the runtime", async () => {
		const { h, ctx, command } = setup();
		ctx.mode = "tui";
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
