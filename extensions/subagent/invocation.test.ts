import { describe, expect, test } from "bun:test";
import { getAgent } from "./agents.ts";
import { buildAgentArgs, getPiInvocation } from "./invocation.ts";

const explorer = getAgent("explorer")!;
const planner = getAgent("planner")!;
const worker = getAgent("worker")!;

function valueAfter(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

describe("buildAgentArgs", () => {
	test("always runs json, print, no-session, with the task last", () => {
		const args = buildAgentArgs(planner, "plan it", {}, null);
		expect(args.slice(0, 4)).toEqual(["--mode", "json", "-p", "--no-session"]);
		expect(args.at(-1)).toBe("Task: plan it");
	});

	test("inherits the dispatch model and thinking level", () => {
		const args = buildAgentArgs(planner, "t", { model: "anthropic/claude", thinkingLevel: "high" }, null);
		expect(valueAfter(args, "--model")).toBe("anthropic/claude");
		expect(valueAfter(args, "--thinking")).toBe("high");
	});

	test("an agent model overrides the dispatch model and suppresses thinking", () => {
		const pinned = { ...planner, model: "openai/gpt" };
		const args = buildAgentArgs(pinned, "t", { model: "anthropic/claude", thinkingLevel: "high" }, null);
		expect(valueAfter(args, "--model")).toBe("openai/gpt");
		expect(args).not.toContain("--thinking");
	});

	test("passes the tool allowlist and the appended system prompt", () => {
		const args = buildAgentArgs(explorer, "t", {}, "/tmp/prompt.md");
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls");
		expect(valueAfter(args, "--append-system-prompt")).toBe("/tmp/prompt.md");
	});

	test("passes the researcher's web tool allowlist", () => {
		const researcher = getAgent("researcher")!;
		const args = buildAgentArgs(researcher, "t", {}, null);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls,web_search,web_fetch");
	});

	test("readOnly narrows an agent's tools to the reader allowlist", () => {
		const args = buildAgentArgs(worker, "t", {}, null, true);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls");
	});

	test("readOnly forces the reader allowlist for an agent with no tools", () => {
		const inherit = { ...worker, tools: undefined };
		const args = buildAgentArgs(inherit, "t", {}, null, true);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls,web_search,web_fetch");
	});

	test("readOnly never passes a writing or shell tool", () => {
		const tools = valueAfter(buildAgentArgs(worker, "t", {}, null, true), "--tools")!.split(",");
		for (const denied of ["write", "edit", "bash", "powershell", "subagent"]) {
			expect(tools).not.toContain(denied);
		}
	});

	test("omits --tools for an agent with no allowlist", () => {
		const inherit = { ...worker, tools: undefined };
		const args = buildAgentArgs(inherit, "t", {}, null);
		expect(args).not.toContain("--tools");
		expect(args).not.toContain("--append-system-prompt");
	});
});

describe("getPiInvocation", () => {
	test("returns a command and preserves the supplied arguments", () => {
		const invocation = getPiInvocation(["--mode", "json", "Task: hi"]);
		expect(invocation.command.length).toBeGreaterThan(0);
		expect(invocation.args.at(-1)).toBe("Task: hi");
	});
});
