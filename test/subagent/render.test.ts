import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { renderSubagentCall, renderSubagentResult } from "../../extensions/subagent/render.ts";
import { emptyUsage } from "../../extensions/subagent/stream.ts";
import type { SingleResult, SubagentDetails } from "../../extensions/subagent/types.ts";
import { assistantMessage, fakeTheme } from "./helpers.ts";

const theme = fakeTheme();

function single(overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "explorer",
		task: "find auth",
		exitCode: 0,
		messages: [assistantMessage("all done", { input: 100 })],
		stderr: "",
		usage: { ...emptyUsage(), turns: 1 },
		...overrides,
	};
}

function toolResult(details: SubagentDetails, content = "fallback"): AgentToolResult<unknown> {
	return { content: [{ type: "text", text: content }], details };
}

function render(component: { render(width: number): string[] }, width = 80): string {
	return component.render(width).join("\n");
}

describe("renderSubagentCall", () => {
	test("single mode shows the agent and task", () => {
		const text = render(renderSubagentCall({ agent: "explorer", task: "find the retry logic" }, theme));
		expect(text).toContain("subagent");
		expect(text).toContain("explorer");
		expect(text).toContain("find the retry logic");
	});

	test("parallel mode shows the task count and agents", () => {
		const text = render(
			renderSubagentCall({ tasks: [{ agent: "explorer", task: "a" }, { agent: "planner", task: "b" }] }, theme),
		);
		expect(text).toContain("parallel · 2 tasks");
		expect(text).toContain("1. explorer");
		expect(text).toContain("2. planner");
	});

	test("chain mode numbers steps and strips the placeholder", () => {
		const text = render(
			renderSubagentCall({ chain: [{ agent: "explorer", task: "find {previous}" }, { agent: "worker", task: "build" }] }, theme),
		);
		expect(text).toContain("chain · 2 steps");
		expect(text).toContain("1.");
		expect(text).toContain("worker");
		expect(text).not.toContain("{previous}");
	});

	test("notes a per-task cwd that differs from the session cwd", () => {
		const text = render(renderSubagentCall({ agent: "explorer", task: "x", cwd: "/tmp/elsewhere" }, theme, { cwd: "/repo" }));
		expect(text).toContain("in /tmp/elsewhere");
		expect(render(renderSubagentCall({ agent: "explorer", task: "x" }, theme, { cwd: "/repo" }))).not.toContain("in ");
	});
});

describe("renderSubagentResult", () => {
	test("collapsed single success shows output and usage", () => {
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [single()] }), { expanded: false }, theme));
		expect(text).toContain("✓");
		expect(text).toContain("explorer");
		expect(text).toContain("all done");
	});

	test("collapsed single failure shows the error", () => {
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "quota exceeded" });
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme));
		expect(text).toContain("✗");
		expect(text).toContain("quota exceeded");
	});

	test("expanded single shows task and output sections", () => {
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [single()] }), { expanded: true }, theme));
		expect(text).toContain("Task");
		expect(text).toContain("Output");
		expect(text).toContain("find auth");
	});

	test("collapsed parallel reports the count and a total", () => {
		const details: SubagentDetails = {
			mode: "parallel",
			results: [single(), single({ agent: "planner" })],
		};
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("parallel");
		expect(text).toContain("2/2 tasks");
		expect(text).toContain("Total:");
	});

	test("parallel shows a running placeholder before completion", () => {
		const running = single({ exitCode: -1, messages: [] });
		const details: SubagentDetails = { mode: "parallel", results: [running, single()] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("running");
	});

	test("chain labels steps", () => {
		const details: SubagentDetails = {
			mode: "chain",
			results: [single({ step: 1 }), single({ step: 2, agent: "worker" })],
		};
		const text = render(renderSubagentResult(toolResult(details), { expanded: true }, theme));
		expect(text).toContain("Step 1");
		expect(text).toContain("Step 2");
	});

	test("falls back to content when there are no results", () => {
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [] }, "nothing here"), { expanded: false }, theme));
		expect(text.trim()).toBe("nothing here");
	});

	test("multi view surfaces the failure count and error detail", () => {
		const failed = single({ agent: "worker", exitCode: 1, stopReason: "error", errorMessage: "permission denied" });
		const details: SubagentDetails = { mode: "parallel", results: [single(), failed] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("1/2 tasks (1 failed)");
		expect(text).toContain("Error: permission denied");
	});

	test("multi expanded view surfaces the error too", () => {
		const failed = single({ agent: "worker", exitCode: 1, stopReason: "error", errorMessage: "boom" });
		const details: SubagentDetails = { mode: "parallel", results: [single(), failed] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: true }, theme));
		expect(text).toContain("Error: boom");
	});

	test("falls back to stderr when a failure has no error message", () => {
		const failed = single({ exitCode: 1, stderr: "fatal: EACCES\n" });
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme));
		expect(text).toContain("Error: fatal: EACCES");
	});

	test("expanded view keeps intermediate assistant text", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "thinking out loud" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "intermediate note" },
					{ type: "toolCall", name: "bash", arguments: { command: "ls" } },
				],
			},
			assistantMessage("final answer"),
		] as any;
		const result = single({ messages });
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [result] }), { expanded: true }, theme));
		expect(text).toContain("thinking out loud");
		expect(text).toContain("intermediate note");
		expect(text).toContain("final answer");
	});

	test("running results show an elapsed-time label", () => {
		const now = Date.now();
		const running = single({ exitCode: -1, messages: [], startedAt: now - 12000 });
		const text = render(renderSubagentResult(toolResult({ mode: "single", results: [running] }), { expanded: false }, theme));
		expect(text).toContain("12s");
	});
});
