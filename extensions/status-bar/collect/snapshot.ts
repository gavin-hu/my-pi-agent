/**
 * Gather the data the status bar renders.
 *
 * `createSnapshotReader` memoizes the usage scan per branch leaf, because a
 * session can hold thousands of entries and the footer renders on every frame.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FooterData, StatusSnapshot } from "../types.ts";
import { emptyUsage, scanUsage } from "./entries.ts";

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
