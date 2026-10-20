import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { PLAN_MODE_ENTRY_TYPE } from "../../lib/plan-state.ts";
import { registerCheckCommand } from "./commands.ts";
import type { CheckRuntime } from "./runtime.ts";
import type { CheckResult, CheckTarget } from "./types.ts";

/** A result fixture. */
function result(overrides: Partial<CheckResult> = {}): CheckResult {
	return {
		target: "all",
		status: "passed",
		commands: ["fake-check"],
		exitCode: 0,
		durationMs: 1000,
		truncated: false,
		failures: [],
		tail: "",
		...overrides,
	};
}

/** A runtime double with one observable active run. */
function runtimeFor(value: CheckResult) {
	const seen: CheckTarget[] = [];
	let starts = 0;
	const runtime = {
		start: (target: CheckTarget) => {
			starts += 1;
			seen.push(target);
			return {
				target,
				commands: ["fake-check"],
				lines: () => ["$ fake-check"],
				elapsedMs: () => 1000,
				promise: Promise.resolve(value),
				cancel: () => {},
			};
		},
		run: async (target: CheckTarget) => {
			seen.push(target);
			return value;
		},
		isRunning: () => false,
		shutdown: () => {},
	} as unknown as CheckRuntime;
	return { runtime, seen, starts: () => starts };
}

/** Register `/check` over a runtime. */
function commandFor(runtime: CheckRuntime) {
	const fake = makeFakePi();
	registerCheckCommand(fake.pi, runtime);
	return fake.commands.get("check");
}

describe("/check", () => {
	test("runs headless and reports a passing summary", async () => {
		const { runtime, seen } = runtimeFor(result());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("", ctx);

		expect(seen).toEqual(["all"]);
		expect(ctx.notices.at(-1)?.message).toContain("Check passed");
	});

	test("reports a failing run headlessly with its failures", async () => {
		const { runtime } = runtimeFor(
			result({
				status: "failed",
				exitCode: 1,
				failures: [{ path: "src/a.ts", line: 2, message: "nope", command: "fake-check" }],
			}),
		);
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("test", ctx);

		expect(ctx.notices.at(-1)?.message).toContain("src/a.ts:2");
	});

	test("rejects an unknown target", async () => {
		const { runtime, seen } = runtimeFor(result());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "print", hasUI: false, branch: [] }).ctx;

		await command.handler("coverage", ctx);

		expect(seen).toEqual([]);
		expect(ctx.notices.at(-1)?.message).toContain("Unknown check target");
	});

	test("refuses in plan mode", async () => {
		const { runtime, starts } = runtimeFor(result());
		const command = commandFor(runtime);
		const ctx = fakeCtx({
			mode: "tui",
			branch: [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }],
		}).ctx;

		await command.handler("", ctx);

		expect(starts()).toBe(0);
		expect(ctx.notices.at(-1)?.message).toContain("Plan mode is read-only");
	});

	test("mounts the run screen and reports a pass in the TUI", async () => {
		const { runtime } = runtimeFor(result());
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		let mounts = 0;
		ctx.ui.custom = async (factory: any) => {
			mounts += 1;
			return await new Promise((resolve) => {
				factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
			});
		};

		await command.handler("", ctx);

		expect(mounts).toBe(1);
		expect(ctx.notices.at(-1)?.message).toContain("Check passed");
	});

	test("mounts the result screen for a failed TUI run", async () => {
		const { runtime } = runtimeFor(
			result({
				status: "failed",
				exitCode: 1,
				failures: [{ path: "src/a.ts", line: 2, message: "nope", command: "fake-check" }],
			}),
		);
		const command = commandFor(runtime);
		const ctx = fakeCtx({ mode: "tui", hasUI: true, branch: [] }).ctx;
		let mounts = 0;
		ctx.ui.custom = async (factory: any) => {
			mounts += 1;
			if (mounts === 1) {
				return await new Promise((resolve) => {
					factory({ requestRender: () => {}, terminal: { rows: 40 } }, ctx.ui.theme, {}, resolve);
				});
			}
			return undefined;
		};

		await command.handler("", ctx);

		expect(mounts).toBe(2);
		expect(ctx.notices).toHaveLength(0);
	});

	test("offers target completions", () => {
		const command = commandFor(runtimeFor(result()).runtime);
		const items = command.getArgumentCompletions("t");

		expect(items?.map((item: { value: string }) => item.value)).toEqual(["test ", "typecheck "]);
		expect(command.getArgumentCompletions("test extra")).toBeNull();
	});
});
