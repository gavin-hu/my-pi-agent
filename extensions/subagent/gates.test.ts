/**
 * The gates on a delegated child: what it may reach, and whether it may delegate.
 *
 * The read-only allowlist becomes the child's `--tools` argument, so it is the enforcement rather
 * than a hint. One sentence holds that gate — a read-only child gets the workspace readers and
 * nothing else — and it is checked in three places, because a caller sees none of them and a
 * refactor can move any one alone: the constant, what an agent is granted, and the argv actually
 * spawned. The names that leave the machine come from `lib/tool-names.ts`, so a third web tool is
 * refused by this gate rather than remembered by it.
 *
 * The second gate is depth. A child that tries to delegate is refused by `runSingleAgent` — the one
 * dispatcher all three modes reach — because an agent that declares no tools inherits the host's
 * whole default set, which no `--tools` filter here can narrow. The marker in its environment is
 * what lets the child answer for itself.
 */

import { describe, expect, test } from "bun:test";
import { WORKSPACE_READERS } from "../../lib/policy.ts";
import { EGRESS_TOOLS, SUBAGENT_TOOL } from "../../lib/tool-names.ts";
import { BUILTIN_AGENTS, type AgentConfig } from "./agents.ts";
import { buildAgentArgs, READ_ONLY_TOOLS, readOnlyTools } from "./invocation.ts";
import { CHILD_ENV, CHILD_REFUSAL, runSingleAgent } from "./run.ts";
import { makeFakeSpawn } from "../../test/helpers/fixtures/subagent.ts";
import { withEnv } from "../../test/helpers/env.ts";

const worker = BUILTIN_AGENTS.find((agent) => agent.name === "worker")!;

/**
 * The agents a read-only call can be pointed at: one that declares a list, one that
 * declares none, and an external one whose list asks for the network — plus one whose
 * file asks for the delegation tool itself.
 */
function shapes(): AgentConfig[] {
	return [
		worker,
		{ ...worker, tools: undefined },
		{ ...worker, source: "project", tools: [...EGRESS_TOOLS, "read"] },
		{ ...worker, source: "user", tools: [SUBAGENT_TOOL, "read", "write"] },
	];
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

describe("a writing child", () => {
	test("is never granted the delegation tool, whatever its file asks for", () => {
		for (const agent of shapes()) {
			const args = buildAgentArgs(agent, "t", {}, null, false);
			const at = args.indexOf("--tools");
			// An agent that declares no list inherits the host's defaults, which `--tools` cannot
			// narrow — the refusal below is the gate for that shape, not this one.
			if (at === -1) continue;
			expect(args[at + 1]!.split(","), agent.source).not.toContain(SUBAGENT_TOOL);
		}
	});

	test("refuses to delegate from inside a child, and spawns nothing", async () => {
		// The inherited-list shape on purpose: it is the one the `--tools` filter cannot reach, so
		// the case holds the marker and the refusal rather than a list.
		const inherited = { ...worker, tools: undefined };
		await withEnv({ [CHILD_ENV]: "1" }, async () => {
			// A child that closes at once, so a refusal that went missing shows up as a run that
			// succeeded rather than as a case that hung.
			const { spawn, children } = makeFakeSpawn((child) => child.close(0));
			const result = await runSingleAgent({
				defaultCwd: process.cwd(),
				defaults: {},
				agentName: inherited.name,
				agents: [inherited],
				task: "delegate this again",
				makeDetails: (results) => ({ mode: "single", results }),
				spawn,
			});
			expect(result.exitCode).toBe(1);
			expect(result.errorMessage).toBe(CHILD_REFUSAL);
			expect(children.length, "a refused child spawns no grandchild").toBe(0);
		});
	});
});
