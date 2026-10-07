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
		expect(text).toContain("parallel 2 tasks");
		expect(text).toContain("explorer");
		expect(text).toContain("planner");
	});

	test("chain mode numbers steps and strips the placeholder", () => {
		const text = render(
			renderSubagentCall({ chain: [{ agent: "explorer", task: "find {previous}" }, { agent: "worker", task: "build" }] }, theme),
		);
		expect(text).toContain("chain 2 steps");
		expect(text).toContain("1.");
		expect(text).toContain("worker");
		expect(text).not.toContain("{previous}");
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
});
