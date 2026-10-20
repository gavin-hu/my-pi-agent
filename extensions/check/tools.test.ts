import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../test/helpers/fakes.ts";
import type { CheckResult, CheckTarget } from "./types.ts";
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

/** Register the tool over a runtime that returns `value`. */
function harness(value: CheckResult | ((target: CheckTarget) => CheckResult)) {
	const seen: CheckTarget[] = [];
	const runtime = {
		run: async (target: CheckTarget) => {
			seen.push(target);
			return typeof value === "function" ? value(target) : value;
		},
	} as unknown as CheckRuntime;
	const fake = createFakePi();
	registerCheckTool(fake.pi, runtime);
	const tool = fake.tools.get(TOOL_NAME);
	return { tool, seen };
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
});
