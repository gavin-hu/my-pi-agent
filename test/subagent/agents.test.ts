import { describe, expect, test } from "bun:test";
import { BUILTIN_AGENTS, formatAgentList, getAgent, listAgents } from "../../extensions/subagent/agents.ts";

describe("built-in agents", () => {
	test("ships explorer, planner, reviewer, and worker in order", () => {
		expect(BUILTIN_AGENTS.map((agent) => agent.name)).toEqual(["explorer", "planner", "reviewer", "worker"]);
		expect(listAgents()).toHaveLength(4);
	});

	test("every agent has a description and a system prompt", () => {
		for (const agent of BUILTIN_AGENTS) {
			expect(agent.description.length).toBeGreaterThan(0);
			expect(agent.systemPrompt.length).toBeGreaterThan(0);
			expect(agent.model).toBeUndefined();
		}
	});

	test("read-only agents use an allowlist; worker inherits all tools", () => {
		expect(getAgent("explorer")?.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
		expect(getAgent("planner")?.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(getAgent("reviewer")?.tools).toContain("bash");
		expect(getAgent("worker")?.tools).toBeUndefined();
	});

	test("looks up agents by name", () => {
		expect(getAgent("planner")?.name).toBe("planner");
		expect(getAgent("missing")).toBeUndefined();
	});

	test("formats a list for error messages", () => {
		const list = formatAgentList();
		for (const agent of BUILTIN_AGENTS) expect(list).toContain(agent.name);
	});
});
