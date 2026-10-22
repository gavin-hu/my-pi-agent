import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Container, getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { emptyUsage } from "./stream.ts";
import { renderSubagentCall, renderSubagentResult, type StreamedSubagentArgs } from "./render.ts";
import type { SingleResult, SubagentDetails } from "./types.ts";
import { assistantMessage, fakeTheme } from "../../test/helpers/fixtures/subagent.ts";
import { coloringTheme } from "../../test/helpers/fakes.ts";

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

/** What a test may vary about the rendered block. */
interface ViewOptions {
	expanded?: boolean;
	isPartial?: boolean;
	now?: number;
	theme?: Theme;
	/** The result's fallback text, when a test needs its own. */
	content?: string;
}

/** The rendered result block for one details object, collapsed unless asked. */
function view(details: SubagentDetails, options: ViewOptions = {}): string[] {
	return renderSubagentResult(
		toolResult(details, options.content),
		{ expanded: options.expanded ?? false, isPartial: options.isPartial, now: options.now },
		options.theme ?? theme,
	).render(80);
}

/** The same block as one string, for the tests that match text rather than lines. */
function viewText(details: SubagentDetails, options: ViewOptions = {}): string {
	return view(details, options).join("\n");
}

describe("renderSubagentCall", () => {
	test("single mode shows the agent and task", () => {
		const text = render(renderSubagentCall({ agent: "explorer", task: "find the retry logic" }, theme));
		expect(text).toContain("subagent");
		expect(text).toContain("explorer");
		expect(text).toContain("find the retry logic");
	});

	test("renders the task with the body colour, not the faintest", () => {
		const text = render(renderSubagentCall({ agent: "explorer", task: "find the retry logic" }, coloringTheme));
		expect(text).toContain("[muted]find the retry logic");
	});

	test("marks a read-only call", () => {
		const text = render(renderSubagentCall({ agent: "explorer", task: "find", readOnly: true }, theme));
		expect(text).toContain("read-only");
	});

	test("strips control characters from a model-supplied agent name", () => {
		const text = render(renderSubagentCall({ agent: "explorer\u001b[31m", task: "find" }, theme));
		expect(text).toContain("explorer");
		expect(text).not.toContain("\u001b");
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

	test("continuation lines carry no indent of their own", () => {
		// The tool-block frame indents everything after the headline by `BODY_INDENT`.
		const lines = render(
			renderSubagentCall(
				{
					tasks: [
						{ agent: "explorer", task: "a" },
						{ agent: "planner", task: "b" },
					],
				},
				theme,
			),
		).split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[1]?.startsWith("1.")).toBe(true);
		expect(lines[2]?.startsWith("2.")).toBe(true);
	});

	test("caps a long list at three rows and counts the rest", () => {
		const tasks = Array.from({ length: 5 }, (_, index) => ({ agent: "explorer", task: `task ${index}` }));
		const text = render(renderSubagentCall({ tasks }, theme));
		expect(text).toContain("parallel · 5 tasks");
		expect(text).toContain("3. explorer");
		expect(text).toContain("… +2 more");
		expect(text).not.toContain("4. explorer");
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

	test("survives a partially-streamed call", () => {
		// Pi renders every snapshot of the streaming arguments: an element can arrive
		// before its fields, and a value can still carry a type the schema rejects.
		const partials: (StreamedSubagentArgs | undefined)[] = [
			undefined,
			{},
			{ chain: [] },
			{ tasks: [] },
			{ chain: "nope" },
			{ tasks: {} },
			{ chain: [{}] },
			{ tasks: [{}] },
			{ chain: [{ agent: 1, task: null, cwd: 2 }] },
			{ tasks: [{ task: "x" }, null] },
			{ agent: 1, task: 2, readOnly: "yes" },
		];
		for (const args of partials) {
			expect(() => render(renderSubagentCall(args, theme)), JSON.stringify(args)).not.toThrow();
		}
	});

	test("reads a step whose fields have not arrived as a placeholder", () => {
		const text = render(renderSubagentCall({ chain: [{}] }, theme));
		expect(text).toContain("chain · 1 step");
		expect(text).toContain("1. … …");
	});

	test("reads a list that is not an array as absent", () => {
		const text = render(renderSubagentCall({ chain: "nope", agent: "explorer", task: "go" }, theme));
		expect(text).toContain("explorer");
		expect(text).not.toContain("chain ·");
	});

	test("reuses the slot Text", () => {
		const first = renderSubagentCall({ agent: "explorer", task: "a" }, theme, { lastComponent: undefined });
		const second = renderSubagentCall({ agent: "explorer", task: "b" }, theme, { lastComponent: first });
		expect(second).toBe(first);
		expect(render(first)).toContain("b");
	});
});

describe("renderSubagentResult", () => {
	test("names a background start and points at /agents", () => {
		const text = viewText({
			mode: "single",
			results: [],
			background: { runId: "a1", agent: "explorer", task: "find auth", cwd: "/repo", startedAt: NOW },
		});

		expect(text).toContain("Started explorer as a1");
		expect(text).toContain("/agents");
	});

	test("collapsed single success shows output and usage", () => {
		const text = viewText({ mode: "single", results: [single()] });
		expect(text).toContain("✓");
		expect(text).toContain("explorer");
		expect(text).toContain("all done");
		expect(text).toContain("1 turn");
	});

	test("the collapsed footer is a blank line, the usage row, then the hint", () => {
		const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
		const block = view({ mode: "single", results: [single({ messages: [assistantMessage(long)] })] });

		// The affordance is the block's last line, as in the multi view and every other tool block.
		expect(block.at(-1)).toContain("to expand");
		expect(block.at(-2)).toContain("1 turn");
		// A blank line separates the metrics row from the body, matching the expanded view.
		expect(block.at(-3)?.trim()).toBe("");
	});

	test("omits the metrics row when the child reported no usage", () => {
		const blank = single({ usage: emptyUsage() });
		const block = view({ mode: "single", results: [blank] });
		expect(block.at(-1)?.trim()).toBe("all done");
		expect(block.join("\n")).not.toContain("turn");
	});

	test("prints no money in either view, because the footer prices the run", () => {
		const priced = single({ usage: { ...emptyUsage(), turns: 1, cost: 1.5 } });
		for (const expanded of [false, true]) {
			expect(view({ mode: "single", results: [priced] }, { expanded }).join("\n")).not.toContain("$");
		}
	});

	test("paints the agent name with the accent, matching the call line", () => {
		const text = viewText({ mode: "single", results: [single()] }, { theme: coloringTheme });
		expect(text).toContain("[accent][bold]explorer");
	});

	test("names the source of a non-builtin agent", () => {
		const custom = single({ agent: "auditor", agentSource: "user" });
		const text = viewText({ mode: "single", results: [custom] });
		expect(text).toContain("auditor [user]");
	});

	test("collapsed single failure shows the error", () => {
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "quota exceeded" });
		const text = viewText({ mode: "single", results: [failed] });
		expect(text).toContain("✗");
		expect(text).toContain("quota exceeded");
	});

	test("expanded single shows task and output sections", () => {
		const text = viewText({ mode: "single", results: [single()] }, { expanded: true });
		expect(text).toContain("Task");
		expect(text).toContain("Output");
		expect(text).toContain("find auth");
	});

	test("expanded single names the transcript it kept", () => {
		const kept = single({ artifactPath: "/repo/.pi/subagents/20261015-143012-a1b2c3", artifactBytes: 42 });
		const text = viewText({ mode: "single", results: [kept] }, { expanded: true });
		expect(text).toContain("/repo/.pi/subagents/20261015-143012-a1b2c3");
	});

	test("expanded single marks a truncated transcript", () => {
		const truncated = single({ artifactPath: "/repo/.pi/subagents/run", artifactTruncated: true });
		const text = viewText({ mode: "single", results: [truncated] }, { expanded: true });
		expect(text).toContain("(truncated)");
	});

	test("expanded single reports an unwritable transcript", () => {
		const broken = single({ artifactError: "EACCES: permission denied" });
		const text = viewText({ mode: "single", results: [broken] }, { expanded: true });
		expect(text).toContain("EACCES: permission denied");
	});

	test("a timed-out run reports its deadline in both views", () => {
		const late = single({ exitCode: 1, timedOut: true, timeoutMs: 600_000, errorMessage: "Timed out after 10m00s" });
		const details: SubagentDetails = { mode: "single", results: [late] };
		expect(viewText(details)).toContain("Timed out after 10m00s");
		expect(viewText(details, { expanded: true })).toContain("Timed out after 10m00s");
	});

	test("collapsed parallel reports the count and a total", () => {
		const text = viewText({
			mode: "parallel",
			results: [single(), single({ agent: "planner" })],
		});
		expect(text).toContain("parallel");
		expect(text).toContain("2/2 tasks");
		expect(text).toContain("Total:");
	});

	test("the parallel total names the model the tasks agree on", () => {
		const results = [
			single({ model: "claude-sonnet-4-5", usage: { ...emptyUsage(), turns: 1, contextTokens: 900 } }),
			single({ agent: "planner", model: "claude-sonnet-4-5" }),
		];
		const text = viewText({ mode: "parallel", results });
		expect(text).toContain("Total: 2 turns claude-sonnet-4-5");
		// Every child has its own window, so an aggregate says nothing about context.
		expect(text).not.toContain("ctx:");
	});

	test("a mixed-model total names no model", () => {
		const results = [single({ model: "claude-sonnet-4-5" }), single({ agent: "planner", model: "gpt-5" })];
		const text = viewText({ mode: "parallel", results });
		expect(text).toContain("Total: 2 turns");
		expect(text).not.toContain("claude-sonnet-4-5");
		expect(text).not.toContain("gpt-5");
	});

	test("parallel shows a running placeholder before completion", () => {
		const running = single({ exitCode: -1, messages: [] });
		const details: SubagentDetails = { mode: "parallel", results: [running, single()] };
		const text = viewText(details);
		expect(text).toContain("running");
	});

	test("chain labels steps", () => {
		const details: SubagentDetails = {
			mode: "chain",
			results: [single({ step: 1 }), single({ step: 2, agent: "worker" })],
		};
		const text = viewText(details, { expanded: true });
		expect(text).toContain("Step 1");
		expect(text).toContain("Step 2");
	});

	test("falls back to content when there are no results", () => {
		const text = viewText({ mode: "single", results: [] }, { content: "nothing here" });
		expect(text.trim()).toBe("nothing here");
	});

	test("multi view surfaces the failure count and error detail", () => {
		const failed = single({ agent: "worker", exitCode: 1, stopReason: "error", errorMessage: "permission denied" });
		const details: SubagentDetails = { mode: "parallel", results: [single(), failed] };
		const text = viewText(details);
		expect(text).toContain("1/2 tasks (1 failed)");
		expect(text).toContain("Error: permission denied");
	});

	test("multi expanded view surfaces the error too", () => {
		const failed = single({ agent: "worker", exitCode: 1, stopReason: "error", errorMessage: "boom" });
		const details: SubagentDetails = { mode: "parallel", results: [single(), failed] };
		const text = viewText(details, { expanded: true });
		expect(text).toContain("Error: boom");
	});

	test("falls back to stderr when a failure has no error message", () => {
		const failed = single({ exitCode: 1, stderr: "fatal: EACCES\n" });
		const text = viewText({ mode: "single", results: [failed] });
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
		] as never;
		const result = single({ messages });
		const text = viewText({ mode: "single", results: [result] }, { expanded: true });
		expect(text).toContain("thinking out loud");
		expect(text).toContain("intermediate note");
		expect(text).toContain("final answer");
	});

	test("running results show an elapsed-time label", () => {
		const running = single({ exitCode: -1, messages: [], startedAt: NOW - 12000 });
		const text = viewText({ mode: "single", results: [running] }, { now: NOW });
		expect(text).toContain("12.0s");
	});

	test("the running glyph animates on the repaint clock", () => {
		const running = single({ exitCode: -1, messages: [], startedAt: NOW });
		const renderAt = (now: number) => viewText({ mode: "single", results: [running] }, { now });
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const first = renderAt(NOW);
		const second = renderAt(NOW + 1000);
		expect(first).not.toContain("⏳");
		expect(frames.some((frame) => first.includes(frame))).toBe(true);
		expect(frames.some((frame) => second.includes(frame))).toBe(true);
		expect(first).not.toBe(second);
	});

	test("an in-flight streamed parallel task shows as running, not failed", () => {
		const streaming = single({ agent: "explorer", exitCode: -1, messages: [assistantMessage("working")] });
		const details: SubagentDetails = { mode: "parallel", results: [streaming, single({ agent: "planner" })] };
		const text = viewText(details, { isPartial: true });
		expect(text).toContain("1. explorer");
		expect(text).not.toContain("✗");
		expect(text).toContain("1/2 tasks done, 1 running");
	});

	test("a failed result with many items still offers to expand", () => {
		const messages = Array.from({ length: 12 }, (_, i) => assistantMessage(`note ${i}`));
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "boom", messages });
		const text = viewText({ mode: "single", results: [failed] });
		expect(text).toContain("Error: boom");
		expect(text).toContain("to expand");
	});

	test("a single-step chain keeps its mode header", () => {
		const details: SubagentDetails = { mode: "chain", results: [single({ step: 1 })] };
		const text = viewText(details);
		expect(text).toContain("chain ·");
		expect(text).toContain("Step 1: explorer");
	});

	test("offers to expand when a single message is line-truncated", () => {
		const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
		const text = viewText({ mode: "single", results: [single({ messages: [assistantMessage(long)] })] });
		expect(text).toContain("to expand");
	});

	test("expanded keeps output order when the last message has no text", () => {
		const messages = [
			assistantMessage("EARLY ANSWER"),
			{ role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }] },
		] as never;
		const text = viewText({ mode: "single", results: [single({ messages })] }, { expanded: true });
		expect(text.indexOf("EARLY ANSWER")).toBeLessThan(text.indexOf("ls"));
	});

	test("clips long error detail in the collapsed view", () => {
		const stderr = Array.from({ length: 30 }, (_, i) => `stderr line ${i}`).join("\n");
		const failed = single({ exitCode: 1, stopReason: "error", stderr });
		const text = viewText({ mode: "single", results: [failed] });
		expect(text).toContain("Error: stderr line 0");
		expect(text).toContain("…");
		expect(text).not.toContain("stderr line 29");
	});

	test("a stopped chain counts the requested steps", () => {
		const failed = single({ agent: "planner", exitCode: 1, stopReason: "error", errorMessage: "boom", step: 1 });
		const details: SubagentDetails = { mode: "chain", results: [failed], total: 3 };
		const text = viewText(details);
		expect(text).toContain("0/3 steps");
		expect(text).toContain("(1 failed, stopped at step 1)");
	});

	test("collapsed parallel labels each task by index and task text", () => {
		const details: SubagentDetails = {
			mode: "parallel",
			results: [single({ agent: "explorer", task: "map auth" }), single({ agent: "explorer", task: "map billing" })],
		};
		const text = viewText(details);
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
		const text = viewText(details, { isPartial: true });
		expect(text).toContain("running (1 failed)");
	});

	test("offers to expand when a single error is truncated", () => {
		const failed = single({ exitCode: 1, stopReason: "error", errorMessage: "x".repeat(1000) });
		const text = viewText({ mode: "single", results: [failed] });
		expect(text).toContain("to expand");
	});

	test("offers to expand when a multi error is truncated", () => {
		const failed = single({ agent: "planner", exitCode: 1, stopReason: "error", stderr: "e".repeat(1000) });
		const details: SubagentDetails = { mode: "parallel", results: [failed, single({ agent: "worker" })] };
		const text = viewText(details);
		expect(text).toContain("to expand");
	});

	test("expanded blank output falls back to (no output)", () => {
		const blank = single({
			messages: [{ role: "assistant", content: [{ type: "text", text: "   " }] }] as never,
		});
		const text = viewText({ mode: "single", results: [blank] }, { expanded: true });
		expect(text).toContain("Output");
		expect(text).toContain("(no output)");
	});

	test("surfaces a tool-error count in the usage line", () => {
		expect(viewText({ mode: "single", results: [single({ toolErrors: 2 })] })).toContain("2 tool errors");
		expect(viewText({ mode: "single", results: [single({ toolErrors: 1 })] })).toContain("1 tool error");
	});

	test("multi Total sums tool errors across results", () => {
		const text = viewText({
			mode: "parallel",
			results: [single({ toolErrors: 1 }), single({ toolErrors: 2 })],
		});
		expect(text).toContain("Total:");
		expect(text).toContain("3 tool errors");
	});

	test("strips terminal control characters from collapsed and expanded text", () => {
		const messages = [assistantMessage("early \u001b[1mBOLD"), assistantMessage("Result: \u001b[31mRED")];
		const result = single({ messages });
		const collapsed = viewText({ mode: "single", results: [result] });
		expect(collapsed).not.toContain("\u001b");
		const expanded = viewText({ mode: "single", results: [result] }, { expanded: true });
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
		const text = viewText({ mode: "chain", results: [step] }, { expanded: true });
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
		const text = viewText(details);
		expect(text).toContain("plan using {previous}");
		expect(text).not.toContain("PRIOR-OUTPUT");
	});

	test("a message-less failure shows the exit code and a reason", () => {
		const failed = single({ exitCode: 1, messages: [], stderr: "" });
		const text = viewText({ mode: "single", results: [failed] });
		expect(text).toContain("exit 1");
		expect(text).toContain("Subprocess exited with code 1");
	});
});

describe("keybinding and reuse", () => {
	const ctx = () => ({ state: {}, invalidate: () => {}, lastComponent: undefined });

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
			const text = viewText({ mode: "single", results: [single({ messages: [assistantMessage(long)] })] });
			expect(text).toContain("ctrl+o to expand");
		} finally {
			setKeybindings(previous);
		}
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
