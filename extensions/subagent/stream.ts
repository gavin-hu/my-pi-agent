/**
 * Pure helpers for turning the subagent's JSON event stream into a result.
 *
 * Pi emits one JSON object per line in `--mode json`. This module is kept free
 * of process/IO code so it can be unit-tested by feeding lines directly.
 */

import type { Message } from "@earendil-works/pi-ai";
import type { SingleResult, UsageStats } from "./types.ts";

/** A zeroed usage accumulator. */
export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** A fresh result for one subagent run; `exitCode: -1` marks it still running. */
export function createResult(agent: string, task: string, extra: Partial<SingleResult> = {}): SingleResult {
	return { agent, task, exitCode: -1, messages: [], stderr: "", usage: emptyUsage(), ...extra };
}

/** Parse one stdout line; returns undefined for blank or malformed lines. */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
	if (!line.trim()) return undefined;
	try {
		const parsed: unknown = JSON.parse(line);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Fold one parsed event into `result`.
 *
 * Returns true when the result changed, which the runner uses to throttle
 * `onUpdate` calls. `message_end` is authoritative: it carries the assistant
 * message (and therefore usage, model, and stop reason) plus tool-result
 * messages. `tool_execution_end` only contributes a failure count.
 */
export function applyEvent(result: SingleResult, event: unknown): boolean {
	if (!event || typeof event !== "object") return false;
	const record = event as Record<string, unknown>;

	if (record.type === "message_end" && record.message) {
		const message = record.message as Message;
		result.messages.push(message);

		if (message.role === "assistant") {
			const assistant = message as Message & {
				model?: string;
				stopReason?: string;
				errorMessage?: string;
				usage?: {
					input?: number;
					output?: number;
					cacheRead?: number;
					cacheWrite?: number;
					totalTokens?: number;
					cost?: { total?: number };
				};
			};
			result.usage.turns++;
			const usage = assistant.usage;
			if (usage) {
				result.usage.input += usage.input ?? 0;
				result.usage.output += usage.output ?? 0;
				result.usage.cacheRead += usage.cacheRead ?? 0;
				result.usage.cacheWrite += usage.cacheWrite ?? 0;
				result.usage.cost += usage.cost?.total ?? 0;
				result.usage.contextTokens = usage.totalTokens ?? result.usage.contextTokens;
			}
			if (!result.model && assistant.model) result.model = assistant.model;
			if (assistant.stopReason) result.stopReason = assistant.stopReason;
			if (assistant.errorMessage) result.errorMessage = assistant.errorMessage;
		}
		return true;
	}

	if (record.type === "tool_execution_end" && record.isError) {
		result.toolErrors = (result.toolErrors ?? 0) + 1;
		return true;
	}

	return false;
}

/** The last assistant text part, or `""`. */
export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}

/** True when the subprocess failed or the model ended in an error/abort. */
export function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

/** Model-facing text for a result: error detail when failed, otherwise final output. */
export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

/** Truncate to at most `cap` UTF-8 bytes, appending a notice with the omitted count. */
export function truncateOutput(text: string, cap: number): string {
	const byteLength = Buffer.byteLength(text, "utf8");
	if (byteLength <= cap) return text;

	let truncated = text.slice(0, cap);
	while (Buffer.byteLength(truncated, "utf8") > cap) truncated = truncated.slice(0, -1);
	const omitted = byteLength - Buffer.byteLength(truncated, "utf8");
	return `${truncated}\n\n[Output truncated: ${omitted} bytes omitted. Full output preserved in tool details.]`;
}

/** Run `fn` over `items` with at most `concurrency` in flight, preserving order. */
export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;

	const worker = async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	};

	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}
