/**
 * The read-only gate: what a delegated child may reach.
 *
 * The allowlist becomes the child's `--tools` argument, so it is the enforcement rather
 * than a hint. One sentence holds the whole gate — a read-only child gets the workspace
 * readers and nothing else — and it is checked in three places, because a caller sees none
 * of them and a refactor can move any one alone: the constant, what an agent is granted,
 * and the argv actually spawned. The names that leave the machine come from
 * `lib/tool-names.ts`, so a third web tool is refused by this gate rather than remembered
 * by it.
 */

import { describe, expect, test } from "bun:test";
import { WORKSPACE_READERS } from "../../lib/policy.ts";
import { EGRESS_TOOLS } from "../../lib/tool-names.ts";
import { BUILTIN_AGENTS, type AgentConfig } from "./agents.ts";
import { buildAgentArgs, READ_ONLY_TOOLS, readOnlyTools } from "./invocation.ts";

const worker = BUILTIN_AGENTS.find((agent) => agent.name === "worker")!;

/**
 * The agents a read-only call can be pointed at: one that declares a list, one that
 * declares none, and an external one whose list asks for the network.
 */
function shapes(): AgentConfig[] {
	return [worker, { ...worker, tools: undefined }, { ...worker, source: "project", tools: [...EGRESS_TOOLS, "read"] }];
}

describe("a read-only child", () => {
	test("is granted the workspace readers and nothing else", () => {
		expect([...READ_ONLY_TOOLS]).toEqual([...WORKSPACE_READERS]);
	});

	test("is never granted a tool whose payload leaves the machine", () => {
		for (const agent of shapes()) {
			for (const egress of EGRESS_TOOLS) expect(readOnlyTools(agent), agent.source).not.toContain(egress);
		}
	});

	test("spawns an argv whose tool list carries no outbound name", () => {
		for (const agent of shapes()) {
			const args = buildAgentArgs(agent, "t", {}, null, true);
			const at = args.indexOf("--tools");
			expect(at, "a read-only run always names its tools").toBeGreaterThan(-1);
			const granted = args[at + 1]!;
			for (const egress of EGRESS_TOOLS) expect(granted!.split(",")).not.toContain(egress);
		}
	});
});
