import { describe, expect, test } from "bun:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createFakePi, fakeTheme } from "../../test/helpers/fakes.ts";
import type { CheckResult, CheckTarget, RunCheckDetails } from "./types.ts";
import type { CheckRuntime } from "./runtime.ts";
import { TOOL_NAME, registerCheckTool } from "./tools.ts";

/** A result fixture. */
function result(overrides: Partial<CheckResult> = {}): CheckResult {
	return {
		target: "test",
		status: "passed",
		commands: ["npm run test"],
		exitCode: 0,
		durationMs: 1200,
		truncated: false,
		failures: [],
		tail: "",
		...overrides,
	};
}

/** Register the tool over a runtime that settles with `value`. */
function harness(value: CheckResult | ((target: CheckTarget) => CheckResult)) {
	const seen: CheckTarget[] = [];
	const runtime = {
		start: (target: CheckTarget) => {
			seen.push(target);
			const settled = typeof value === "function" ? value(target) : value;
			return {
				target,
				commands: settled.commands,
				lines: () => [],
				elapsedMs: () => settled.durationMs,
				promise: Promise.resolve(settled),
				cancel: () => {},
			};
		},
	} as unknown as CheckRuntime;
	const fake = createFakePi();
	registerCheckTool(fake.pi, runtime);
	const tool = fake.tools.get(TOOL_NAME);
	return { tool, seen };
}

/** A render context with the fields the tool's renderers read. */
function renderContext(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "call-1",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/home/u/repo",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

/** Mount a result on the tool's renderer and return its plain text. */
function mount(
	tool: { renderResult: (...args: unknown[]) => { render: (width: number) => string[] } },
	toolResult: { content: unknown; details: unknown },
	options: { expanded?: boolean; isPartial?: boolean } = {},
	context = renderContext(options),
): string {
	const component = tool.renderResult(
		{ content: toolResult.content, details: toolResult.details },
		{ expanded: options.expanded === true, isPartial: options.isPartial === true },
		fakeTheme,
		context,
	);
	return stripTerminalSequences(component.render(80).join("\n"));
}

describe("run_check", () => {
	test("reports a passing run", async () => {
		const { tool } = harness(result());
		const outcome = await tool.execute("t", { target: "test" }, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(false);
		expect(outcome.content[0]?.text).toContain("Check passed: npm run test");
		expect(outcome.structuredContent).toMatchObject({ target: "test", status: "passed", exitCode: 0 });
		expect(outcome.details.tail).toBe("");
	});

	test("reports a failing run as a normal result, not a tool error", async () => {
		const { tool } = harness(
			result({
				status: "failed",
				exitCode: 1,
				failures: [{ path: "src/a.ts", line: 2, message: "nope", command: "npm run test" }],
				tail: "src/a.ts:2: nope",
			}),
		);
		const outcome = await tool.execute("t", { target: "test" }, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(false);
		expect(outcome.content[0]?.text).toContain("Check failed: 1 failure");
		expect(outcome.content[0]?.text).toContain("src/a.ts:2");
		expect(outcome.structuredContent?.failures).toHaveLength(1);
	});

	test("reports a planning error as a tool error", async () => {
		const { tool } = harness(result({ status: "error", commands: [], exitCode: null, error: "No command detected" }));
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(outcome.isError).toBe(true);
		expect(outcome.content[0]?.text).toContain("Check failed to run");
		expect(outcome.structuredContent?.status).toBe("error");
	});

	test("defaults the target to all", async () => {
		const { tool, seen } = harness(result({ target: "all" }));
		await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(seen).toEqual(["all"]);
	});

	test("falls back to the tail when nothing parsed", async () => {
		const { tool } = harness(
			result({
				status: "failed",
				exitCode: 2,
				failures: [{ message: "Command exited with status 2", command: "make verify" }],
				tail: "prose\nmore prose",
			}),
		);
		const outcome = await tool.execute("t", { target: "all" }, undefined, undefined, {} as never);

		expect(outcome.content[0]?.text).toContain("Tail:");
		expect(outcome.content[0]?.text).toContain("more prose");
	});

	test("publishes one running result before the run settles", async () => {
		const { tool } = harness(result());
		const partials: Array<{ details: RunCheckDetails }> = [];
		await tool.execute(
			"t",
			{ target: "test" },
			undefined,
			(partial: { details: RunCheckDetails }) => {
				partials.push(partial);
			},
			{} as never,
		);

		expect(partials).toHaveLength(1);
		expect(partials[0]?.details).toMatchObject({
			target: "test",
			status: "running",
			commands: ["npm run test"],
			failures: [],
		});
	});
});

describe("run_check rendering", () => {
	test("names the target on the call line", () => {
		const { tool } = harness(result());
		const call = (args: Record<string, unknown>, context = renderContext()) =>
			stripTerminalSequences(tool.renderCall(args, fakeTheme, context).render(80).join("\n"));

		expect(call({ target: "test" })).toContain("run_check");
		expect(call({ target: "test" })).toContain("test");
		expect(call({})).toContain("all");
		expect(call({}, renderContext({ argsComplete: false }))).toContain("…");
	});

	test("draws a passing run in one line", async () => {
		const { tool } = harness(result());
		const outcome = await tool.execute("t", { target: "test" }, undefined, undefined, {} as never);
		const text = mount(tool, outcome);

		expect(text).toContain("✓");
		expect(text).toContain("passed · npm run test · 1.2s");
		expect(text.split("\n")).toHaveLength(1);
	});

	test("draws parsed failures and keeps the model report out of the transcript", async () => {
		const { tool } = harness(
			result({
				status: "failed",
				exitCode: 1,
				failures: [{ path: "src/a.ts", line: 2, message: "nope", command: "npm run test" }],
				tail: "src/a.ts:2: nope",
			}),
		);
		const outcome = await tool.execute("t", { target: "test" }, undefined, undefined, {} as never);
		const text = mount(tool, outcome);

		expect(text).toContain("✗");
		expect(text).toContain("1 failure · npm run test · 1.2s");
		expect(text).toContain("src/a.ts:2 · nope");
		expect(text).not.toContain("Check failed:");
	});

	test("draws an error result as an error line", async () => {
		const { tool } = harness(result({ status: "error", commands: [], exitCode: null, error: "No command detected" }));
		const outcome = await tool.execute("t", {}, undefined, undefined, {} as never);

		expect(mount(tool, outcome)).toContain("Error: No command detected");
	});

	test("draws a rejection as a sanitized error", () => {
		const { tool } = harness(result());
		const rejected = { content: [{ type: "text", text: "Error: Permission denied" }], details: {} };
		const text = mount(tool, rejected);

		expect(text).toContain("Error: Permission denied");
		expect(text).not.toContain("Error: Error:");
	});

	test("draws a running line from the partial result", async () => {
		const { tool } = harness(result());
		let partial: { details: RunCheckDetails } | undefined;
		const outcome = await tool.execute(
			"t",
			{ target: "test" },
			undefined,
			(value: { details: RunCheckDetails }) => {
				partial = value;
			},
			{} as never,
		);
		expect(partial).toBeDefined();

		const context = renderContext({ isPartial: true });
		const text = mount(tool, partial as { content: unknown; details: unknown }, { isPartial: true }, context);
		expect(text).toContain("Running npm run test…");

		// A settled render clears the one-second repaint the partial started.
		mount(tool, outcome, {}, context);
	});
});
