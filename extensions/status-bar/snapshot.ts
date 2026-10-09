/**
 * Gather the data the status bar renders.
 *
 * `scanUsage` mirrors Pi's built-in footer: it sums token/cost totals across
 * the whole session and keeps the latest cache hit rate. `createSnapshotReader`
 * memoizes that scan per branch leaf, because a session can hold thousands of
 * entries and the footer renders on every frame.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FooterData, StatusSnapshot, UsageTotals } from "./types.ts";

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

function emptyUsage(): UsageTotals {
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

/**
 * Build a reader that memoizes the usage scan by branch leaf.
 *
 * Every append moves the session's leaf, so `sessionId:leafId` is enough to
 * know the totals are stale; this avoids copying the full entry list per frame.
 */
export function createSnapshotReader() {
	let key: string | null = null;
	let usage = emptyUsage();
	let cacheHitRate: number | null = null;

	return (ctx: ExtensionContext, footerData: FooterData): StatusSnapshot => {
		const session = ctx.sessionManager;
		const nextKey = `${session.getSessionId()}:${session.getLeafId() ?? ""}`;
		if (nextKey !== key) {
			const scanned = scanUsage(session.getEntries());
			usage = scanned.usage;
			cacheHitRate = scanned.cacheHitRate;
			key = nextKey;
		}

		const usageInfo = ctx.getContextUsage();
		const context = {
			tokens: usageInfo?.tokens ?? null,
			contextWindow: usageInfo?.contextWindow ?? ctx.model?.contextWindow ?? 0,
			percent: usageInfo?.percent ?? null,
		};

		const model = ctx.model
			? { id: ctx.model.id, provider: ctx.model.provider, reasoning: ctx.model.reasoning === true }
			: null;

		return {
			cwd: ctx.cwd,
			sessionName: ctx.sessionManager.getSessionName() ?? null,
			branch: footerData.getGitBranch(),
			statuses: footerData.getExtensionStatuses(),
			model,
			thinkingLevel: ctx.thinkingLevel ?? null,
			context,
			usage,
			cacheHitRate,
			providerCount: footerData.getAvailableProviderCount(),
		};
	};
}
