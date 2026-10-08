import { describe, expect, test } from "bun:test";
import subagent, { TOOL_NAME } from "../../extensions/subagent/index.ts";
import type { RunOptions } from "../../extensions/subagent/run.ts";
import { emptyUsage } from "../../extensions/subagent/stream.ts";
import type { SingleResult } from "../../extensions/subagent/types.ts";
import { assistantMessage, fakeToolCtx, makeFakePi } from "./helpers.ts";

function success(agent: string, text: string): SingleResult {
	return { agent, task: "t", exitCode: 0, messages: [assistantMessage(text)], stderr: "", usage: emptyUsage() };
}

function failure(agent: string, message: string): SingleResult {
	return {
		agent,
		task: "t",
		exitCode: 1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		stopReason: "error",
		errorMessage: message,
	};
}

function register(run: (options: RunOptions) => Promise<SingleResult>) {
	const { pi, tools } = makeFakePi();
	subagent(pi, { run });
	const tool = tools.get(TOOL_NAME);
	if (!tool) throw new Error("subagent tool was not registered");
	return tool;
}

function call(tool: any, params: unknown, ctx = fakeToolCtx()): Promise<any> {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}

describe("subagent registration", () => {
	test("registers a direct, active tool", () => {
		const tool = register(async (options) => success(options.agentName, "ok"));
		expect(tool).toBeDefined();
		expect(tool.exposure).toBe("direct");
		expect(tool.defaultActive).toBe(true);
		expect(tool.annotations).toEqual({ readOnlyHint: false, openWorldHint: true });
	});
});

describe("subagent mode validation", () => {
	test("rejects an empty call without running anything", async () => {
		let calls = 0;
		const tool = register(async () => {
			calls++;
			return success("explorer", "ok");
		});
		const result = await call(tool, {});
		expect(calls).toBe(0);
		expect(result.content[0].text).toContain("Provide one mode");
		expect(result.details.results).toEqual([]);
	});
});

describe("subagent single mode", () => {
	test("returns the final output and dispatch defaults", async () => {
		const seen: RunOptions[] = [];
		const tool = register(async (options) => {
			seen.push(options);
			return success(options.agentName, "found it");
		});

		const result = await call(tool, { agent: "explorer", task: "find it" });
		expect(result.content[0].text).toBe("found it");
		expect(result.details.mode).toBe("single");
		expect(seen[0]).toMatchObject({
			agentName: "explorer",
			task: "find it",
			defaultCwd: "/repo",
			defaults: { model: "anthropic/claude-sonnet-4-5", thinkingLevel: "medium" },
		});
	});

	test("marks a failed run as an error", async () => {
		const tool = register(async () => failure("explorer", "no luck"));
		const result = await call(tool, { agent: "explorer", task: "find it" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("no luck");
	});
});

describe("subagent parallel mode", () => {
	test("runs every task and summarizes the outcomes", async () => {
		const tasks: string[] = [];
		const tool = register(async (options) => {
			tasks.push(options.task);
			return success(options.agentName, `out:${options.task}`);
		});

		const result = await call(tool, {
			tasks: [
				{ agent: "explorer", task: "auth" },
				{ agent: "planner", task: "billing" },
			],
		});

		expect(tasks).toEqual(["auth", "billing"]);
		expect(result.details.mode).toBe("parallel");
		expect(result.details.results).toHaveLength(2);
		expect(result.content[0].text).toContain("2/2 succeeded");
		expect(result.content[0].text).toContain("[explorer] completed");
	});

	test("reports failed tasks without dropping successful ones", async () => {
		const tool = register(async (options) =>
			options.agentName === "planner" ? failure("planner", "boom") : success("explorer", "ok"),
		);
		const result = await call(tool, {
			tasks: [
				{ agent: "explorer", task: "a" },
				{ agent: "planner", task: "b" },
			],
		});
		expect(result.content[0].text).toContain("1/2 succeeded");
		expect(result.content[0].text).toContain("[planner] failed");
	});
});

describe("subagent chain mode", () => {
	test("passes each output forward via {previous}", async () => {
		const tasks: string[] = [];
		const tool = register(async (options) => {
			tasks.push(options.task);
			return success(options.agentName, `out-${tasks.length}`);
		});

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "find" },
				{ agent: "planner", task: "plan using {previous}" },
			],
		});

		expect(tasks).toEqual(["find", "plan using out-1"]);
		expect(result.details.mode).toBe("chain");
		expect(result.content[0].text).toBe("out-2");
	});

	test("stops and reports the failing step", async () => {
		let calls = 0;
		const tool = register(async () => {
			calls++;
			return failure("planner", "step failed");
		});

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "one" },
				{ agent: "planner", task: "two" },
				{ agent: "worker", task: "three" },
			],
		});

		expect(calls).toBe(1);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Chain stopped at step 1");
	});
});
