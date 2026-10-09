import type { Message } from "@earendil-works/pi-ai";
import { fakeTheme as sharedFakeTheme } from "../fakes.ts";

export { makeSubagentSpawn as makeFakeSpawn, SubagentChild as FakeChild, waitFor } from "../process.ts";

/** A theme double with identity colorization, for pure render/format tests. */
export function fakeTheme(): any {
	return sharedFakeTheme;
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
