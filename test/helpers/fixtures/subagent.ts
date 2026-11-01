import type { Message } from "@earendil-works/pi-ai";
import subagent, { TOOL_NAME } from "../../../extensions/subagent/index.ts";
import type { RunOptions } from "../../../extensions/subagent/run.ts";
import type { SingleResult } from "../../../extensions/subagent/types.ts";
import { makeFakePi } from "../fakes.ts";

export { makeSubagentSpawn as makeFakeSpawn, SubagentChild as FakeChild, waitFor } from "../process.ts";

/**
 * The `subagent` tool as Pi registers it, with an injectable runner.
 *
 * Every suite that drives the tool needs this same seam, so the tool's own `pi` rides on the
 * return value and a suite reaches the entries a run appends through it.
 */
export function registerSubagentTool(run: (options: RunOptions) => Promise<SingleResult>) {
	const { pi, tools } = makeFakePi();
	subagent(pi, { run });
	const tool = tools.get(TOOL_NAME);
	if (!tool) throw new Error("subagent tool was not registered");
	return Object.assign(tool, { pi });
}

/** An assistant message with the fields the runner reads. */
export function assistantMessage(
	text: string,
	options: {
		model?: string;
		stopReason?: string;
		errorMessage?: string;
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: number;
	} = {},
): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		model: options.model ?? "claude-sonnet-4-5",
		stopReason: options.stopReason ?? "stop",
		errorMessage: options.errorMessage,
		usage: {
			input: options.input ?? 0,
			output: options.output ?? 0,
			cacheRead: options.cacheRead ?? 0,
			cacheWrite: options.cacheWrite ?? 0,
			totalTokens: options.totalTokens ?? 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: options.cost ?? 0,
			},
		},
	} as unknown as Message;
}

/** A minimal tool context; only `cwd`, `model`, and `thinkingLevel` are read. */
export function fakeToolCtx(
	overrides: { cwd?: string; model?: { provider: string; id: string } | undefined } = {},
): any {
	return {
		cwd: overrides.cwd ?? "/repo",
		model: overrides.model === undefined ? { provider: "anthropic", id: "claude-sonnet-4-5" } : overrides.model,
		thinkingLevel: "medium",
	};
}
