/**
 * Reduce session entries to cumulative token/cost totals.
 *
 * `scanUsage` mirrors Pi's built-in footer: it sums token/cost totals across
 * the whole session and keeps the latest cache hit rate. Sources are assistant
 * messages, usage entries, tool results that performed nested model work, and
 * the summaries a compaction or branch summary generated.
 */

import type { UsageTotals } from "../types.ts";

interface EntryLike {
	type?: string;
	usage?: Partial<UsageLike>;
	message?: {
		role?: string;
		usage?: Partial<UsageLike>;
	};
}

interface UsageLike {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

/** Zeroed totals; the starting point for every accumulation. */
export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** Sum usage entries and track the latest cache hit rate. */
export function scanUsage(entries: Iterable<unknown>): { usage: UsageTotals; cacheHitRate: number | null } {
	const usage = emptyUsage();
	let cacheHitRate: number | null = null;

	for (const raw of entries) {
		const entry = raw as EntryLike;
		let value: Partial<UsageLike> | undefined;
		let isAssistant = false;

		if (entry?.type === "usage") {
			value = entry.usage;
		} else if (entry?.type === "message" && entry.message?.role === "assistant") {
			value = entry.message.usage;
			isAssistant = true;
		} else if (entry?.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
			value = entry.message.usage;
		} else if ((entry?.type === "branch_summary" || entry?.type === "compaction") && entry.usage) {
			value = entry.usage;
		}

		if (!value) continue;

		const input = value.input ?? 0;
		const output = value.output ?? 0;
		const cacheRead = value.cacheRead ?? 0;
		const cacheWrite = value.cacheWrite ?? 0;
		usage.input += input;
		usage.output += output;
		usage.cacheRead += cacheRead;
		usage.cacheWrite += cacheWrite;
		usage.cost += value.cost?.total ?? 0;

		if (isAssistant) {
			const prompt = input + cacheRead + cacheWrite;
			cacheHitRate = prompt > 0 ? (cacheRead / prompt) * 100 : null;
		}
	}

	return { usage, cacheHitRate };
}
