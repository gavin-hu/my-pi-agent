/**
 * Shared types for the subagent extension.
 *
 * The runner is deliberately split from process spawning so its logic can be
 * unit-tested against an injected `SpawnFn` without launching a real `pi`.
 */

import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { AgentToolResult, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentSource, AgentScope } from "./agents.ts";

/** Exactly one of the three execution shapes may be requested per call. */
export type SubagentMode = "single" | "parallel" | "chain";

/** Token/cost counters accumulated from a subagent's assistant messages. */
export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

/** Everything captured from one subagent subprocess. */
export interface SingleResult {
	agent: string;
	/** Where the agent definition came from; `"unknown"` when it could not be resolved. */
	agentSource?: AgentSource | "unknown";
	task: string;
	/** Process exit code; `-1` means the subprocess is still running. */
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	/** 1-based position when the subagent ran as a chain step. */
	step?: number;
	/** Count of tool executions that reported `isError`. */
	toolErrors?: number;
	/** Epoch ms when the subprocess started, for the elapsed-time label. */
	startedAt?: number;
	/** Epoch ms when the subprocess finished. */
	finishedAt?: number;
}

/** Structured result carried on the `subagent` tool result for rendering. */
export interface SubagentDetails {
	mode: SubagentMode;
	results: SingleResult[];
	/** External agent directories consulted in this call. */
	agentScope?: AgentScope;
	/** Nearest project agents directory, when one was found. */
	projectAgentsDir?: string | null;
	/**
	 * Total steps/tasks requested, which can exceed `results.length` when a chain
	 * stops early. Defaults to `results.length` when absent.
	 */
	total?: number;
}

/** Model/thinking configuration a subprocess inherits when the agent sets none. */
export interface DispatchDefaults {
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

/** Injectable process factory, defaulting to `node:child_process.spawn`. */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
