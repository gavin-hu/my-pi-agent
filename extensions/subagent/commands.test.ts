import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import type { BackgroundRun, BackgroundRuntime } from "./background.ts";
import { registerAgentsCommand } from "./commands.ts";

const RUNS: BackgroundRun[] = [
	{ id: "a2", agent: "explorer", task: "Map auth", cwd: "/repo", startedAt: 1000, status: "running" },
	{
		id: "a1",
		agent: "reviewer",
		task: "Review",
		cwd: "/repo",
		startedAt: 0,
		finishedAt: 1000,
		status: "finished",
		output: "looks good",
	},
];

/** A runtime double recording the command's calls. */
function runtimeFor(runs: BackgroundRun[] = RUNS) {
	const calls = { collect: [] as string[], cancel: [] as string[] };
	const runtime = {
		start: () => ({ ok: false, error: "unused" }),
		list: () => runs,
		collect: (id: string) => {
			calls.collect.push(id);
			return { ok: true, text: "collected output" } as const;
		},
		cancel: (id: string) => {
			calls.cancel.push(id);
			return true;
		},
		shutdown: () => {},
		subscribe: () => () => {},
	} as unknown as BackgroundRuntime;
	return { runtime, calls };
}

/** Register `/agents` over a runtime. */
function commandFor(runtime: BackgroundRuntime) {
	const fake = makeFakePi();
	registerAgentsCommand(fake.pi, runtime);
	return { fake, command: fake.commands.get("agents") };
}

describe("/agents", () => {
	test("prints the list headlessly", async () => {
		const { runtime } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("a2 explorer");
		expect(ctx.notices.at(-1)?.message).toContain("a1 reviewer");
	});

	test("reports an empty board", async () => {
		const { runtime } = runtimeFor([]);
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("No background subagents yet.");
	});

	test("refuses in plan mode", async () => {
		const { runtime } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({
			mode: "tui",
			branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
		}).ctx;

		await command.handler("", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("collects a finished run and sends it as a user message", async () => {
		const { runtime, calls } = runtimeFor();
		const { fake, command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		ctx.ui.custom = async (factory: any) => {
			await new Promise((resolve) => {
				const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
				component.handleInput("j");
				component.handleInput("c");
			});
		};

		await command.handler("", ctx);

		expect(calls.collect).toEqual(["a1"]);
		expect(fake.sentMessages.at(-1)?.content).toBe("collected output");
	});

	test("cancels a running run and keeps the board open until close", async () => {
		const { runtime, calls } = runtimeFor();
		const { command } = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		ctx.ui.custom = async (factory: any) => {
			await new Promise((resolve) => {
				const component = factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
				component.handleInput("x");
				component.handleInput("\u001b");
			});
		};

		await command.handler("", ctx);

		expect(calls.cancel).toEqual(["a2"]);
	});
});
