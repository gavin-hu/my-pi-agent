import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import subagent, { TOOL_NAME } from "./index.ts";
import type { RunOptions } from "./run.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { assistantMessage, fakeToolCtx } from "../../test/helpers/fixtures/subagent.ts";
import { makeFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

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
		const tool = register(async () => success("explorer", "ok"));
		const result = await call(tool, {});
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

describe("subagent project agents", () => {
	/** A temp repo whose `.pi/agents` holds one project agent. */
	function projectRepo(): string {
		const root = mkdtempSync(join(tmpdir(), "pi-subagent-ctx-"));
		const agentsDir = join(root, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "auditor.md"), "---\nname: auditor\ndescription: Audits\n---\nYou audit.\n", "utf-8");
		return temps.track(root);
	}

	function projectCtx(root: string, trusted: boolean, onConfirm: () => void): any {
		return {
			cwd: root,
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			thinkingLevel: "medium",
			hasUI: true,
			isProjectTrusted: () => trusted,
			ui: {
				confirm: async () => {
					onConfirm();
					return false;
				},
			},
		};
	}

	test("asks before running a project agent and cancels on decline", async () => {
		const root = projectRepo();
		let confirmed = 0;
		const tool = register(async (options) => success(options.agentName, "ok"));
		const result = await call(
			tool,
			{ agent: "auditor", task: "x", agentScope: "both" },
			projectCtx(root, false, () => confirmed++),
		);
		expect(confirmed).toBe(1);
		expect(result.content[0].text).toContain("not approved");
	});

	test("refuses project agents without a UI for an untrusted project", async () => {
		const root = projectRepo();
		const tool = register(async (options) => success(options.agentName, "ok"));
		const headless: any = {
			cwd: root,
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			thinkingLevel: "medium",
			hasUI: false,
			isProjectTrusted: () => false,
			ui: { confirm: async () => true },
		};
		const result = await call(tool, { agent: "auditor", task: "x", agentScope: "both" }, headless);
		expect(result.content[0].text).toContain("Refusing");
	});

	test("runs a project agent without prompting for a trusted project", async () => {
		const root = projectRepo();
		let confirmed = 0;
		const tool = register(async (options) => success(options.agentName, "ok"));
		const result = await call(
			tool,
			{ agent: "auditor", task: "x", agentScope: "both" },
			projectCtx(root, true, () => confirmed++),
		);
		expect(confirmed).toBe(0);
		expect(result.content[0].text).toBe("ok");
	});
});

describe("subagent chain mode", () => {
	test("passes each output forward via {previous}", async () => {
		const tasks: string[] = [];
		const templates: (string | undefined)[] = [];
		const tool = register(async (options) => {
			tasks.push(options.task);
			templates.push(options.taskTemplate);
			return success(options.agentName, `out-${tasks.length}`);
		});

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "find" },
				{ agent: "planner", task: "plan using {previous}" },
			],
		});

		expect(tasks).toEqual(["find", "plan using out-1"]);
		expect(templates).toEqual(["find", "plan using {previous}"]);
		expect(result.details.mode).toBe("chain");
		expect(result.content[0].text).toBe("out-2");
	});

	test("stops and reports the failing step", async () => {
		const tool = register(async () => failure("planner", "step failed"));

		const result = await call(tool, {
			chain: [
				{ agent: "explorer", task: "one" },
				{ agent: "planner", task: "two" },
				{ agent: "worker", task: "three" },
			],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Chain stopped at step 1");
	});
});
