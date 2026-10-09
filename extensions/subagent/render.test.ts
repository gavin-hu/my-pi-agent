import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Container, getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { renderSubagentCall, renderSubagentResult } from "./render.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";
import { assistantMessage } from "../../test/helpers/fixtures/subagent.ts";
import { fakeTheme } from "../../test/helpers/fixtures/subagent.ts";

const theme = fakeTheme();

/** Fixed render time, so elapsed labels never depend on the wall clock. */
const NOW = 1_000_000;

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
			renderSubagentCall(
				{
					tasks: [
						{ agent: "explorer", task: "a" },
						{ agent: "planner", task: "b" },
					],
				},
				theme,
			),
		);
		expect(text).toContain("parallel · 2 tasks");
		expect(text).toContain("1. explorer");
		expect(text).toContain("2. planner");
	});

	test("chain mode numbers steps and strips the placeholder", () => {
		const text = render(
			renderSubagentCall(
				{
					chain: [
						{ agent: "explorer", task: "find {previous}" },
						{ agent: "worker", task: "build" },
					],
				},
				theme,
			),
		);
		expect(text).toContain("chain · 2 steps");
		expect(text).toContain("1.");
		expect(text).toContain("worker");
		expect(text).not.toContain("{previous}");
	});

	test("notes a per-task cwd that differs from the session cwd", () => {
		const text = render(
			renderSubagentCall({ agent: "explorer", task: "x", cwd: "/tmp/elsewhere" }, theme, { cwd: "/repo" }),
		);
		expect(text).toContain("in /tmp/elsewhere");
		expect(render(renderSubagentCall({ agent: "explorer", task: "x" }, theme, { cwd: "/repo" }))).not.toContain("in ");
	});

	test("keeps multi-line task text on one preview line", () => {
		const text = render(renderSubagentCall({ agent: "worker", task: "First line\nSecond line" }, theme));
		expect(text).toContain("First line Second line");
		expect(text.split("\n")).toHaveLength(2);
	});
});

describe("renderSubagentResult", () => {
	test("collapsed single success shows output and usage", () => {
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [single()] }), { expanded: false }, theme),
		);
		expect(text).toContain("✓");
		expect(text).toContain("explorer");
		expect(text).toContain("all done");
	});

	test("collapsed single failure shows the error", () => {
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "quota exceeded" });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
		expect(text).toContain("✗");
		expect(text).toContain("quota exceeded");
	});

	test("expanded single shows task and output sections", () => {
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [single()] }), { expanded: true }, theme),
		);
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
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [] }, "nothing here"), { expanded: false }, theme),
		);
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
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
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
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [result] }), { expanded: true }, theme),
		);
		expect(text).toContain("thinking out loud");
		expect(text).toContain("intermediate note");
		expect(text).toContain("final answer");
	});

	test("running results show an elapsed-time label", () => {
		const running = single({ exitCode: -1, messages: [], startedAt: NOW - 12000 });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [running] }), { expanded: false, now: NOW }, theme),
		);
		expect(text).toContain("12s");
	});

	test("an in-flight streamed parallel task shows as running, not failed", () => {
		const streaming = single({ agent: "explorer", exitCode: -1, messages: [assistantMessage("working")] });
		const details: SubagentDetails = { mode: "parallel", results: [streaming, single({ agent: "planner" })] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false, isPartial: true }, theme));
		expect(text).toContain("1. explorer");
		expect(text).not.toContain("✗");
		expect(text).toContain("1/2 tasks done, 1 running");
	});

	test("a failed result with many items still offers to expand", () => {
		const messages = Array.from({ length: 12 }, (_, i) => assistantMessage(`note ${i}`));
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "boom", messages });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
		expect(text).toContain("Error: boom");
		expect(text).toContain("to expand");
	});

	test("a single-step chain keeps its mode header", () => {
		const details: SubagentDetails = { mode: "chain", results: [single({ step: 1 })] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("chain ·");
		expect(text).toContain("Step 1: explorer");
	});

	test("offers to expand when a single message is line-truncated", () => {
		const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
		const text = render(
			renderSubagentResult(
				toolResult({ mode: "single", results: [single({ messages: [assistantMessage(long)] })] }),
				{ expanded: false },
				theme,
			),
		);
		expect(text).toContain("to expand");
	});

	test("expanded keeps output order when the last message has no text", () => {
		const messages = [
			assistantMessage("EARLY ANSWER"),
			{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] },
		] as any;
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [single({ messages })] }), { expanded: true }, theme),
		);
		expect(text.indexOf("EARLY ANSWER")).toBeLessThan(text.indexOf("ls"));
	});

	test("clips long error detail in the collapsed view", () => {
		const stderr = Array.from({ length: 30 }, (_, i) => `stderr line ${i}`).join("\n");
		const failed = single({ exitCode: 1, stopReason: "error", stderr });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
		expect(text).toContain("Error: stderr line 0");
		expect(text).toContain("…");
		expect(text).not.toContain("stderr line 29");
	});

	test("a stopped chain counts the requested steps", () => {
		const failed = single({ agent: "planner", exitCode: 1, stopReason: "error", errorMessage: "boom", step: 1 });
		const details: SubagentDetails = { mode: "chain", results: [failed], total: 3 };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("0/3 steps");
		expect(text).toContain("(1 failed, stopped at step 1)");
	});

	test("collapsed parallel labels each task by index and task text", () => {
		const details: SubagentDetails = {
			mode: "parallel",
			results: [single({ agent: "explorer", task: "map auth" }), single({ agent: "explorer", task: "map billing" })],
		};
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("1. explorer map auth");
		expect(text).toContain("2. explorer map billing");
	});

	test("a running header still reports an already-failed task", () => {
		const details: SubagentDetails = {
			mode: "parallel",
			results: [
				single({ agent: "planner", exitCode: 1, stopReason: "error", errorMessage: "boom" }),
				single({ agent: "worker", exitCode: -1 }),
			],
		};
		const text = render(renderSubagentResult(toolResult(details), { expanded: false, isPartial: true }, theme));
		expect(text).toContain("running (1 failed)");
	});

	test("offers to expand when a single error is truncated", () => {
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "x".repeat(1000) });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
		expect(text).toContain("to expand");
	});

	test("offers to expand when a multi error is truncated", () => {
		const failed = single({ agent: "planner", exitCode: 1, stopReason: "error", stderr: "e".repeat(1000) });
		const details: SubagentDetails = { mode: "parallel", results: [failed, single({ agent: "worker" })] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("to expand");
	});

	test("expanded blank output falls back to (no output)", () => {
		const blank = single({
			messages: [{ role: "assistant", content: [{ type: "text", text: "   " }] }] as any,
		});
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [blank] }), { expanded: true }, theme),
		);
		expect(text).toContain("Output");
		expect(text).toContain("(no output)");
	});

	test("surfaces a tool-error count in the usage line", () => {
		const text = render(
			renderSubagentResult(
				toolResult({ mode: "single", results: [single({ toolErrors: 2 })] }),
				{ expanded: false },
				theme,
			),
		);
		expect(text).toContain("2 tool errors");
		const one = render(
			renderSubagentResult(
				toolResult({ mode: "single", results: [single({ toolErrors: 1 })] }),
				{ expanded: false },
				theme,
			),
		);
		expect(one).toContain("1 tool error");
	});

	test("multi Total sums tool errors across results", () => {
		const details: SubagentDetails = {
			mode: "parallel",
			results: [single({ toolErrors: 1 }), single({ toolErrors: 2 })],
		};
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("Total:");
		expect(text).toContain("3 tool errors");
	});

	test("strips terminal control characters from collapsed and expanded text", () => {
		const messages = [assistantMessage("early \u001b[1mBOLD"), assistantMessage("Result: \u001b[31mRED")];
		const result = single({ messages });
		const collapsed = render(
			renderSubagentResult(toolResult({ mode: "single", results: [result] }), { expanded: false }, theme),
		);
		expect(collapsed).not.toContain("\u001b");
		const expanded = render(
			renderSubagentResult(toolResult({ mode: "single", results: [result] }), { expanded: true }, theme),
		);
		expect(expanded).not.toContain("\u001b");
		expect(expanded).toContain("early");
	});

	test("expanded chain shows the original task template, not the substituted output", () => {
		const step = single({
			agent: "planner",
			step: 2,
			task: "plan using PRIOR-OUTPUT",
			taskTemplate: "plan using {previous}",
		});
		const text = render(
			renderSubagentResult(toolResult({ mode: "chain", results: [step] }), { expanded: true }, theme),
		);
		expect(text).toContain("plan using {previous}");
		expect(text).not.toContain("PRIOR-OUTPUT");
	});

	test("collapsed chain row shows the original task template", () => {
		const first = single({ agent: "explorer", step: 1, task: "find" });
		const second = single({
			agent: "planner",
			step: 2,
			task: "plan using PRIOR-OUTPUT",
			taskTemplate: "plan using {previous}",
		});
		const details: SubagentDetails = { mode: "chain", results: [first, second] };
		const text = render(renderSubagentResult(toolResult(details), { expanded: false }, theme));
		expect(text).toContain("plan using {previous}");
		expect(text).not.toContain("PRIOR-OUTPUT");
	});

	test("a message-less failure shows the exit code and a reason", () => {
		const failed = single({ exitCode: 1, messages: [], stderr: "" });
		const text = render(
			renderSubagentResult(toolResult({ mode: "single", results: [failed] }), { expanded: false }, theme),
		);
		expect(text).toContain("exit 1");
		expect(text).toContain("Subprocess exited with code 1");
	});
});

describe("spacing, keybinding, and reuse", () => {
	const ctx = () => ({ state: {}, invalidate: () => {}, lastComponent: undefined });

	test("collapsed single separates the header from the body with a blank line", () => {
		const lines = renderSubagentResult(toolResult({ mode: "single", results: [single()] }), { expanded: false }, theme)
			.render(80)
			.map((line) => line.trimEnd());
		expect(lines[0]).toContain("✓ explorer");
		expect(lines[1]).toBe("");
		expect(lines[2]).toContain("all done");
	});

	test("the expand hint follows the bound app.tools.expand key", () => {
		const previous = getKeybindings();
		setKeybindings(
			new KeybindingsManager({
				...TUI_KEYBINDINGS,
				"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
			}),
		);
		try {
			const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
			const text = render(
				renderSubagentResult(
					toolResult({ mode: "single", results: [single({ messages: [assistantMessage(long)] })] }),
					{ expanded: false },
					theme,
				),
			);
			expect(text).toContain("ctrl+o to expand");
		} finally {
			setKeybindings(previous);
		}
	});

	test("renderSubagentCall reuses the slot Text", () => {
		const first = renderSubagentCall({ agent: "explorer", task: "a" }, theme, { lastComponent: undefined });
		const second = renderSubagentCall({ agent: "explorer", task: "b" }, theme, { lastComponent: first });
		expect(second).toBe(first);
		expect(render(first)).toContain("b");
	});

	test("collapsed result reuses the slot Text", () => {
		const first = renderSubagentResult(
			toolResult({ mode: "single", results: [single()] }),
			{ expanded: false },
			theme,
			ctx(),
		);
		const second = renderSubagentResult(
			toolResult({ mode: "single", results: [single({ agent: "planner" })] }),
			{ expanded: false },
			theme,
			{ ...ctx(), lastComponent: first },
		);
		expect(second).toBe(first);
		expect(render(first)).toContain("planner");
	});

	test("expanded result reuses the slot Container", () => {
		const first = renderSubagentResult(
			toolResult({ mode: "single", results: [single()] }),
			{ expanded: true },
			theme,
			ctx(),
		);
		expect(first).toBeInstanceOf(Container);
		const second = renderSubagentResult(
			toolResult({ mode: "single", results: [single({ agent: "planner" })] }),
			{ expanded: true },
			theme,
			{ ...ctx(), lastComponent: first },
		);
		expect(second).toBe(first);
		expect(render(first)).toContain("planner");
	});
});
